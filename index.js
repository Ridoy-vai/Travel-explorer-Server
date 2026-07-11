const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors({
    origin: 'http://localhost:3000', // আপনার ফ্রন্টএন্ডের নির্দিষ্ট URL
    credentials: true,                // ক্রেডেনশিয়াল বা কুকি সাপোর্ট অ্যালাউ করার জন্য
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

require('dotenv').config();
const port = process.env.PORT; 
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server (optional starting in v4.7)
        await client.connect();
        const database = client.db("Travel-Explore");
        const TourPackageCollection = database.collection("TourPackages");
        // const bookingsCollection = database.collection("bookings");

        app.post("/api/agency/packages", async (req, res) => {
            console.log("Received request to add package:", req.body);
            try {
                const body = req.body;

                // Basic required-field check
                const required = ["title", "destination", "category", "basePrice", "coverImage", "agencyId"];
                const missing = required.filter((field) => !body[field]);
                if (missing.length) {
                    return res.status(400).json({
                        message: `Missing required field(s): ${missing.join(", ")}`,
                    });
                }

                const newPackageData = {
                    agencyId: body.agencyId,
                    agencyName: body.agencyName,
                    agencyEmail: body.agencyEmail,
                    agencyPhone: body.agencyPhone,

                    title: body.title,
                    destination: body.destination,
                    category: body.category,
                    shortDescription: body.shortDescription,
                    description: body.description,

                    durationDays: body.durationDays ? Number(body.durationDays) : undefined,
                    durationNights: body.durationNights ? Number(body.durationNights) : undefined,
                    minGroupSize: body.minGroupSize ? Number(body.minGroupSize) : undefined,
                    maxGroupSize: body.maxGroupSize ? Number(body.maxGroupSize) : undefined,

                    basePrice: Number(body.basePrice),
                    discountPrice: body.discountPrice ? Number(body.discountPrice) : undefined,
                    childPrice: body.childPrice ? Number(body.childPrice) : undefined,

                    coverImage: body.coverImage,
                    galleryImages: body.galleryImages || [],

                    itinerary: body.itinerary || [],
                    inclusions: body.inclusions || [],
                    exclusions: body.exclusions || [],

                    departureLocation: body.departureLocation,
                    transportation: body.transportation,
                    accommodation: body.accommodation,

                    tags: body.tags || [],

                    // Always published — this endpoint only handles publishing new packages
                    status: "published",
                    createdAt: new Date()
                };

                const result = await TourPackageCollection.insertOne(newPackageData);

                return res.status(201).json({
                    message: "Package published successfully.",
                    data: {
                        _id: result.insertedId,
                        ...newPackageData
                    },
                });
            } catch (err) {
                console.error("Add package error:", err);
                return res.status(500).json({ message: "Something went wrong while saving the package." });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Travel-Bd is running!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})