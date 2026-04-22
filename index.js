const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(`${process.env.STRIPE_SECRET}`);

const port = process.env.PORT || 3000;

const crypto = require("crypto");

function generateTrakingId(){
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0,10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  
  return `${prefix}-${date}-${random}`;

}

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.etxtqbz.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // create DB
    const db = client.db("zapShiftDB");
    const parcelCollections = db.collection("parcels");
    const paymentCollection = db.collection('payments');

    // Parcels related API's
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.senderEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = parcelCollections.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get a parcel using id
    app.get("/parcels/:parcelId", async (req, res) => {
      const id = req.params.parcelId;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollections.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelCollections.insertOne(parcel);
      res.send(result);
    });

    // Parcel Delete API
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollections.deleteOne(query);
      res.send(result);
    });

    // Payment related API (STRIPE)

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName
              }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });

      // res.redirect(303, session.url);
      // console.log(session);
      res.send({url: session.url});
    });


    // Update payment status
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const trakingId = generateTrakingId();

      if(session.payment_status === 'paid'){
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            trakingId: trakingId
          }
        }

        const result = await parcelCollections.updateOne(query, update);

        const payment = {
          amount: session.amount_total/100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date()
        }

        if(session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({success: true, modifyParcel: result, paymentInfo: resultPayment, trakingId: trakingId, transactionId: session.payment_intent })
        }

      }
      res.send({success: false})
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Zap shift server is working");
});

app.listen(port, () => {
  console.log(`Zap Shift is listening on port ${port}`);
});
