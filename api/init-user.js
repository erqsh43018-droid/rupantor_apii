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


    const userRef =
      db.ref(
        "users/" + uid
      );


    const snapshot =
      await userRef.get();


    if(!snapshot.exists()){

      await userRef.set({

        balance:0,

        createdAt:
          Date.now()

      });

    }


    return res.status(200).json({

      success:true,

      uid:uid

    });


  }catch(error){

    console.error(error);


    return res.status(500).json({

      success:false,

      message:
        "User initialization failed."

    });

  }

}
