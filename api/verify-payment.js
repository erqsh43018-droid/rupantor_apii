const admin = require("firebase-admin");


function getFirebaseApp(){

    if(admin.apps.length){

        return admin.app();

    }


    return admin.initializeApp({

        credential:
            admin.credential.cert({

                projectId:
                    process.env.FIREBASE_PROJECT_ID,

                clientEmail:
                    process.env.FIREBASE_CLIENT_EMAIL,

                privateKey:
                    process.env.FIREBASE_PRIVATE_KEY
                        .replace(/\\n/g,"\n")

            }),

        databaseURL:
            "https://testproject-de1bd-default-rtdb.asia-southeast1.firebasedatabase.app"

    });

}



module.exports = async function(req,res){

    if(req.method !== "POST"){

        return res.status(405).json({

            error:
                "Method not allowed"

        });

    }


    try{

        const authHeader =
            req.headers.authorization || "";


        if(!authHeader.startsWith("Bearer ")){

            return res.status(401).json({

                error:
                    "Authentication required"

            });

        }


        const token =
            authHeader.substring(7);


        const app =
            getFirebaseApp();


        const decoded =
            await app
                .auth()
                .verifyIdToken(token);


        const body =
            req.body || {};


        const orderId =
            body.orderId;


        const transactionId =
            body.transactionId;


        if(
            !orderId
            || !transactionId
        ){

            return res.status(400).json({

                error:
                    "Missing payment information"

            });

        }


        const db =
            app.database();


        const orderRef =
            db.ref(
                "orders/"
                + orderId
            );


        const orderSnapshot =
            await orderRef.once("value");


        if(!orderSnapshot.exists()){

            return res.status(404).json({

                error:
                    "Order not found"

            });

        }


        const order =
            orderSnapshot.val();



        /*
        =====================================
        OWNERSHIP CHECK
        =====================================
        */

        if(order.uid !== decoded.uid){

            return res.status(403).json({

                error:
                    "Order does not belong to this user"

            });

        }



        /*
        =====================================
        ALREADY COMPLETED
        =====================================
        */

        if(
            order.status === "COMPLETED"
            ||
            order.status === "PAID_PENDING_TOPUP"
        ){

            return res.status(200).json({

                success:true,

                alreadyProcessed:true,

                type:
                    order.type,

                amount:
                    order.amount

            });

        }



        /*
        =====================================
        PROCESSING
        =====================================
        */

        if(order.status === "PROCESSING"){

            return res.status(409).json({

                error:
                    "Payment is already being processed"

            });

        }



        /*
        =====================================
        RUPANTORPAY VERIFY
        =====================================
        */

        const verifyResponse =
            await fetch(
                "https://payment.rupantorpay.com/api/payment/verify-payment",
                {

                    method:"POST",

                    headers:{

                        "Content-Type":
                            "application/json",

                        "X-API-KEY":
                            process.env.RUPANTOR_API_KEY,

                        "X-CLIENT":
                            req.headers.host

                    },

                    body:JSON.stringify({

                        transaction_id:
                            transactionId

                    })

                }
            );


        const payment =
            await verifyResponse.json();



        /*
        =====================================
        STATUS CHECK
        =====================================
        */

        if(
            !verifyResponse.ok
            ||
            payment.status !== "COMPLETED"
        ){

            await orderRef.update({

                lastVerifyStatus:
                    payment.status || "ERROR",

                lastVerifyResponse:
                    payment,

                updatedAt:
                    Date.now()

            });


            return res.status(400).json({

                error:
                    "Payment was not completed",

                gatewayStatus:
                    payment.status || "ERROR"

            });

        }



        /*
        =====================================
        AMOUNT CHECK
        =====================================
        */

        const gatewayAmount =
            Number(payment.amount);


        const orderAmount =
            Number(order.amount);


        if(
            !Number.isFinite(gatewayAmount)
            ||
            gatewayAmount !== orderAmount
        ){

            await orderRef.update({

                status:
                    "AMOUNT_MISMATCH",

                gatewayAmount:
                    gatewayAmount,

                expectedAmount:
                    orderAmount,

                updatedAt:
                    Date.now()

            });


            return res.status(400).json({

                error:
                    "Payment amount mismatch"

            });

        }



        /*
        =====================================
        CLAIM ORDER
        =====================================
        */

        const claimResult =
            await orderRef.transaction(
                current => {

                    if(!current){

                        return;

                    }


                    if(
                        current.status !== "PENDING"
                    ){

                        return;

                    }


                    return {

                        ...current,

                        status:
                            "PROCESSING",

                        transactionId,

                        trxId:
                            payment.trx_id || null,

                        processingAt:
                            Date.now()

                    };

                }
            );


        if(
            !claimResult.committed
        ){

            const latest =
                (
                    await orderRef.once("value")
                ).val();


            if(
                latest
                &&
                (
                    latest.status === "COMPLETED"
                    ||
                    latest.status === "PAID_PENDING_TOPUP"
                )
            ){

                return res.status(200).json({

                    success:true,

                    alreadyProcessed:true,

                    type:
                        latest.type

                });

            }


            return res.status(409).json({

                error:
                    "Unable to claim order"

            });

        }



        /*
        =====================================
        WALLET PAYMENT
        =====================================
        */

        if(
            order.type ===
            "wallet_add_money"
        ){

            const userRef =
                db.ref(
                    "users/"
                    + order.uid
                );


            /*
            Atomic multi-location update.
            */

            const updates = {};

            updates[
                "users/"
                + order.uid
                + "/balance"
            ] =
                admin.database.ServerValue.increment(
                    orderAmount
                );


            updates[
                "orders/"
                + orderId
                + "/status"
            ] =
                "COMPLETED";


            updates[
                "orders/"
                + orderId
                + "/verifiedAt"
            ] =
                Date.now();


            updates[
                "orders/"
                + orderId
                + "/trxId"
            ] =
                payment.trx_id || transactionId;


            updates[
                "orders/"
                + orderId
                + "/gatewayStatus"
            ] =
                payment.status;


            await db.ref().update(
                updates
            );


            return res.status(200).json({

                success:true,

                type:
                    "wallet_add_money",

                amount:
                    orderAmount

            });

        }



        /*
        =====================================
        FREE FIRE ORDER
        =====================================
        */

        if(
            order.type ===
            "free_fire_uid_topup"
        ){

            await orderRef.update({

                status:
                    "PAID_PENDING_TOPUP",

                verifiedAt:
                    Date.now(),

                gatewayStatus:
                    payment.status,

                trxId:
                    payment.trx_id || transactionId

            });


            return res.status(200).json({

                success:true,

                type:
                    "free_fire_uid_topup",

                amount:
                    orderAmount,

                message:
                    "Payment verified successfully"

            });

        }



        /*
        =====================================
        UNKNOWN TYPE
        =====================================
        */

        await orderRef.update({

            status:
                "UNKNOWN_PAYMENT_TYPE",

            updatedAt:
                Date.now()

        });


        return res.status(400).json({

            error:
                "Unknown payment type"

        });


    }catch(error){

        console.error(
            "VERIFY PAYMENT ERROR:",
            error
        );


        return res.status(500).json({

            error:
                "Payment verification failed"

        });

    }

};