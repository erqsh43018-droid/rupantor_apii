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
       AUTHENTICATION
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
       AMOUNT
       =============================== */

    const amount =
      Number(req.body.amount);


    if(
      !Number.isFinite(amount) ||
      amount < 1
    ){

      return res.status(400).json({

        message:
          "Invalid amount."

      });

    }


    /*
      Keep money to 2 decimal places.
    */

    const finalAmount =
      Number(
        amount.toFixed(2)
      );


    /* ===============================
       CREATE ORDER
       =============================== */

    const orderRef =
      db.ref("orders").push();


    const orderId =
      orderRef.key;


    await orderRef.set({

      uid:uid,

      amount:
        finalAmount,

      type:
        "add_money",

      status:
        "PENDING",

      createdAt:
        Date.now()

    });


    /* ===============================
       WEBSITE URL
       =============================== */

    const host =
      req.headers["x-forwarded-host"] ||
      req.headers.host;


    const protocol =
      req.headers["x-forwarded-proto"] ||
      "https";


    const siteUrl =
      `${protocol}://${host}`;


    /* ===============================
       RUPANTORPAY CHECKOUT
       =============================== */

    const paymentData = {

      fullname:
        "Customer",

      email:
        "customer@example.com",

      amount:
        finalAmount.toFixed(2),

      success_url:
        `${siteUrl}/?payment=success&orderId=${encodeURIComponent(orderId)}`,

      cancel_url:
        `${siteUrl}/?payment=cancel&orderId=${encodeURIComponent(orderId)}`,

      metadata:{

        orderId:
          orderId,

        uid:
          uid,

        amount:
          finalAmount.toFixed(2),

        type:
          "add_money"

      }

    };


    const response =
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

          body:
            JSON.stringify(
              paymentData
            )

        }
      );


    const data =
      await response.json();


    /* ===============================
       PAYMENT URL CHECK
       =============================== */

    if(
      !response.ok ||
      !data.payment_url
    ){

      await orderRef.update({

        status:
          "FAILED",

        failedAt:
          Date.now()

      });


      return res.status(400).json({

        message:
          data.message ||
          data.error ||
          "Payment creation failed."

      });

    }


    /* ===============================
       RETURN PAYMENT URL
       =============================== */

    return res.status(200).json({

      success:true,

      orderId:
        orderId,

      payment_url:
        data.payment_url

    });


  }catch(error){

    console.error(error);


    return res.status(500).json({

      success:false,

      message:
        "Server error."

    });

  }

}