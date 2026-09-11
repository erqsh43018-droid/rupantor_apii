const admin = require("firebase-admin");

function getFirebaseApp() {

    if (admin.apps.length) {
        return admin.app();
    }

    return admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,

            clientEmail:
                process.env.FIREBASE_CLIENT_EMAIL,

            privateKey:
                process.env.FIREBASE_PRIVATE_KEY
                    .replace(/\\n/g, "\n")
        }),

        databaseURL:
            "https://testproject-de1bd-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}


module.exports = async function(req, res) {

    if(req.method !== "POST"){

        return res.status(405).json({
            error:"Method not allowed"
        });

    }


    try{

        const authHeader =
            req.headers.authorization || "";


        if(!authHeader.startsWith("Bearer ")){

            return res.status(401).json({
                error:"Missing authentication"
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


        const userRef =
            db.ref(
                "users/"
                + decoded.uid
            );


        const snapshot =
            await userRef.once("value");


        if(!snapshot.exists()){

            await userRef.set({

                balance:0,

                createdAt:
                    Date.now()

            });

        }


        return res.status(200).json({

            success:true,

            uid:
                decoded.uid

        });


    }catch(error){

        console.error(
            "INIT USER ERROR:",
            error
        );


        return res.status(500).json({

            error:
                "Unable to initialize user"

        });

    }

};