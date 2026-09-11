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



/*
=========================================
FREE FIRE PRODUCTS
=========================================
*/

const PRODUCTS = {

    ff25:{
        diamonds:25,
        amount:20,
        name:"Free Fire 25 Diamonds"
    },

    ff50:{
        diamonds:50,
        amount:45,
        name:"Free Fire 50 Diamonds"
    },

    ff115:{
        diamonds:115,
        amount:75,
        name:"Free Fire 115 Diamonds"
    },

    ff240:{
        diamonds:240,
        amount:150,
        name:"Free Fire 240 Diamonds"
    },

    ff355:{
        diamonds:355,
        amount:220,
        name:"Free Fire 355 Diamonds"
    },

    ff610:{
        diamonds:610,
        amount:350,
        name:"Free Fire 610 Diamonds"
    }

};



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


        const db =
            app.database();


        const body =
            req.body || {};


        const type =
            body.type;


        /*
        =================================
        WALLET ADD MONEY
        =================================
        */

        if(type === "wallet_add_money"){

            const amount =
                Number(body.amount);


            if(
                !Number.isFinite(amount)
                || amount < 1
                || amount > 100000
            ){

                return res.status(400).json({

                    error:
                        "Invalid amount"

                });

            }


            /*
             * Keep money amount to 2 decimals
             */

            const finalAmount =
                Math.round(
                    amount * 100
                ) / 100;


            return await createGatewayPayment({

                app,
                db,
                uid:
                    decoded.uid,

                type:
                    "wallet_add_money",

                amount:
                    finalAmount,

                product:
                    null,

                req,
                res

            });

        }



        /*
        =================================
        FREE FIRE TOPUP
        =================================
        */

        if(type === "free_fire_uid_topup"){

            const productId =
                body.productId;


            const product =
                PRODUCTS[productId];


            if(!product){

                return res.status(400).json({

                    error:
                        "Invalid product"

                });

            }


            return await createGatewayPayment({

                app,
                db,
                uid:
                    decoded.uid,

                type:
                    "free_fire_uid_topup",

                amount:
                    product.amount,

                product:{
                    id:
                        productId,

                    name:
                        product.name,

                    diamonds:
                        product.diamonds

                },

                req,
                res

            });

        }



        return res.status(400).json({

            error:
                "Invalid payment type"

        });


    }catch(error){

        console.error(
            "CREATE PAYMENT ERROR:",
            error
        );


        return res.status(500).json({

            error:
                "Unable to create payment"

        });

    }

};



async function createGatewayPayment({

    app,
    db,
    uid,
    type,
    amount,
    product,
    req,
    res

}){

    /*
    =====================================
    CREATE ORDER ID
    =====================================
    */

    const orderRef =
        db.ref("orders").push();


    const orderId =
        orderRef.key;


    const orderData = {

        uid,

        amount,

        type,

        status:
            "PENDING",

        createdAt:
            Date.now()

    };


    if(product){

        orderData.product =
            product;

    }


    await orderRef.set(
        orderData
    );



    /*
    =====================================
    RETURN URL
    =====================================
    */

    const host =
        req.headers.host;


    const protocol =
        req.headers["x-forwarded-proto"]
        || "https";


    const baseUrl =
        protocol
        + "://"
        + host;


    const successUrl =
        baseUrl
        + "/?payment=success"
        + "&orderId="
        + encodeURIComponent(orderId);


    const cancelUrl =
        baseUrl
        + "/?payment=cancel"
        + "&orderId="
        + encodeURIComponent(orderId);



    /*
    =====================================
    RUPANTORPAY CHECKOUT
    =====================================
    */

    const checkoutResponse =
        await fetch(
            "https://payment.rupantorpay.com/api/payment/checkout",
            {

                method:"POST",

                headers:{

                    "Content-Type":
                        "application/json",

                    "X-API-KEY":
                        process.env.RUPANTOR_API_KEY,

                    "X-CLIENT":
                        host

                },

                body:JSON.stringify({

                    fullname:
                        "Customer",

                    email:
                        "customer@example.com",

                    amount:
                        amount,

                    success_url:
                        successUrl,

                    cancel_url:
                        cancelUrl,

                    meta_data:{

                        orderId,

                        uid,

                        type,

                        amount,

                        product:
                            product || null

                    }

                })

            }
        );



    const data =
        await checkoutResponse.json();


    if(
        !checkoutResponse.ok
        || !data.payment_url
    ){

        await orderRef.update({

            status:
                "PAYMENT_CREATION_FAILED",

            error:
                data,

            updatedAt:
                Date.now()

        });


        return res.status(502).json({

            error:
                "Unable to create gateway payment"

        });

    }



    /*
    =====================================
    SAVE PAYMENT URL
    =====================================
    */

    await orderRef.update({

        paymentUrl:
            data.payment_url,

        updatedAt:
            Date.now()

    });



    return res.status(200).json({

        success:true,

        orderId,

        payment_url:
            data.payment_url

    });

}