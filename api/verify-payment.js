import admin from "firebase-admin";


/* =========================================
   FIREBASE ADMIN
   ========================================= */

if(!admin.apps.length){

  admin.initializeApp({

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


const db =
  admin.database();


/* ========================================= */

export default async function handler(
  req,
  res
){

  if(req.method !== "POST"){

    return res.status(405).json({
      message:"Method not allowed"
    });

  }


  try{

    /* ===============================
       AUTH
       =============================== */

    const authHeader =
      req.headers.authorization || "";


    if(
      !authHeader.startsWith("Bearer ")
    ){

      return res.status(401).json({
        message:"Unauthorized"
      });

    }


    const token =
      authHeader.substring(7);


    const decoded =
      await admin.auth()
        .verifyIdToken(token);


    const uid =
      decoded.uid;


    /* ===============================
       REQUEST DATA
       =============================== */

    const {
      orderId,
      transactionId
    } = req.body;


    if(
      !orderId ||
      !transactionId
    ){

      return res.status(400).json({

        message:
          "Missing payment information."

      });

    }


    /* ===============================
       GET ORDER
       =============================== */

    const orderRef =
      db.ref(
        "orders/" + orderId
      );


    const orderSnapshot =
      await orderRef.get();


    if(!orderSnapshot.exists()){

      return res.status(404).json({

        message:
          "Order not found."

      });

    }


    const order =
      orderSnapshot.val();


    /* ===============================
       USER CHECK
       =============================== */

    if(order.uid !== uid){

      return res.status(403).json({

        message:
          "Invalid order."

      });

    }


    /* ===============================
       DUPLICATE CHECK
       =============================== */

    if(order.status === "COMPLETED"){

      return res.status(200).json({

        success:true,

        message:
          "Payment already verified."

      });

    }


    if(order.status === "PROCESSING"){

      return res.status(409).json({

        success:false,

        message:
          "Payment verification is already processing."

      });

    }


    /* ===============================
       RUPANTORPAY VERIFY
       =============================== */

    const response =
      await fetch(
        "https://payment.rupantorpay.com/api/payment/verify-payment",
        {

          method:"POST",

          headers:{

            "Content-Type":
              "application/json",

            "X-API-KEY":
              process.env.RUPANTOR_API_KEY

          },

          body:
            JSON.stringify({

              transaction_id:
                transactionId

            })

        }
      );


    const data =
      await response.json();


    /* ===============================
       STATUS CHECK
       =============================== */

    if(data.status !== "COMPLETED"){

      await orderRef.update({

        status:
          data.status || "FAILED",

        transactionId:
          transactionId,

        verifiedAt:
          Date.now()

      });


      return res.status(400).json({

        success:false,

        message:
          "Payment is not completed."

      });

    }


    /* ===============================
       AMOUNT CHECK
       =============================== */

    const paidAmount =
      Number(data.amount);


    const orderAmount =
      Number(order.amount);


    if(
      !Number.isFinite(paidAmount) ||
      paidAmount !== orderAmount
    ){

      await orderRef.update({

        status:
          "AMOUNT_MISMATCH",

        transactionId:
          transactionId,

        paidAmount:
          paidAmount,

        verifiedAt:
          Date.now()

      });


      return res.status(400).json({

        success:false,

        message:
          "Payment amount does not match."

      });

    }


    /* ===============================
       CLAIM ORDER
       =============================== */

    const claimResult =
      await orderRef.transaction(
        currentOrder => {

          if(!currentOrder){

            return;

          }


          if(
            currentOrder.status !==
            "PENDING"
          ){

            return;

          }


          return {

            ...currentOrder,

            status:
              "PROCESSING",

            transactionId:
              transactionId,

            paidAmount:
              paidAmount,

            processingAt:
              Date.now()

          };

        }
      );


    if(
      !claimResult.committed
    ){

      return res.status(409).json({

        success:false,

        message:
          "Payment is already being processed."

      });

    }


    /* ===============================
       ADD BALANCE
       =============================== */

    const userBalancePath =
      "users/" +
      uid +
      "/balance";


    const balanceIncrement =
      admin.database.ServerValue.increment(
        orderAmount
      );


    const updates = {};


    updates[userBalancePath] =
      balanceIncrement;


    updates[
      "orders/" +
      orderId +
      "/status"
    ] =
      "COMPLETED";


    updates[
      "orders/" +
      orderId +
      "/verifiedAt"
    ] =
      Date.now();


    updates[
      "orders/" +
      orderId +
      "/trxId"
    ] =
      data.trx_id || null;


    await db.ref().update(
      updates
    );


    /* ===============================
       SUCCESS
       =============================== */

    return res.status(200).json({

      success:true,

      message:
        "Balance added successfully.",

      amount:
        orderAmount,

      transactionId:
        transactionId

    });


  }catch(error){

    console.error(error);


    return res.status(500).json({

      success:false,

      message:
        "Payment verification failed."

    });

  }

}