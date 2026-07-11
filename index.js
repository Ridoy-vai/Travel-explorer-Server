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
const { ObjectId } = require("mongodb");
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
        const usersCollection = database.collection("user");
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
                    status: body.status || "published",
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

        // const TourPackageCollection = database.collection("TourPackages");
        app.get("/api/agency/packages", async (req, res) => {
            try {
                const {
                    agencyId,
                    status = "published", // কোন ট্যাব active সেটা (published/unpublished/draft)
                    page = 1,
                    limit = 5,
                } = req.query;

                // agencyId টা লাগবেই — যেহেতু এটা agency-specific ড্যাশবোর্ড
                if (!agencyId) {
                    return res.status(400).send({
                        success: false,
                        message: "agencyId is required",
                    });
                }

                const query = { agencyId, status };
                const skip = (Number(page) - 1) * Number(limit);

                // মূল ডাটা fetch (পেজিনেটেড)
                const packages = await TourPackageCollection.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit))
                    .toArray();

                // মোট কতগুলো ম্যাচ করলো (pagination এর জন্য)
                const total = await TourPackageCollection.countDocuments(query);

                // Tabs এর পাশে count দেখানোর জন্য প্রতিটা status এর সংখ্যা আলাদাভাবে বের করা
                const statusCountsAgg = await TourPackageCollection.aggregate([
                    { $match: { agencyId } },
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                ]).toArray();

                const statusCounts = { published: 0, unpublished: 0, draft: 0 };
                statusCountsAgg.forEach((item) => {
                    statusCounts[item._id] = item.count;
                });

                res.send({
                    success: true,
                    data: packages,
                    meta: {
                        total,
                        page: Number(page),
                        limit: Number(limit),
                        totalPages: Math.ceil(total / Number(limit)),
                    },
                    statusCounts,
                });
            } catch (error) {
                console.error("Error fetching agency packages:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch packages",
                    error: error.message,
                });
            }
        });

        // no need jwt verification for now, because this is just a test project and not a production-ready application. In a real-world scenario, you would implement proper authentication and authorization mechanisms.
        app.get("/api/packages", async (req, res) => {
            try {
                const page = Math.max(parseInt(req.query.page) || 1, 1);
                const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 50);
                const skip = (page - 1) * limit;

                const filter = { status: "published" };

                if (req.query.category) {
                    filter.category = req.query.category;
                }
                if (req.query.destination) {
                    filter.destination = { $regex: req.query.destination, $options: "i" };
                }
                if (req.query.search) {
                    filter.$or = [
                        { title: { $regex: req.query.search, $options: "i" } },
                        { destination: { $regex: req.query.search, $options: "i" } },
                        { shortDescription: { $regex: req.query.search, $options: "i" } },
                        { tags: { $regex: req.query.search, $options: "i" } },
                    ];
                }
                if (req.query.minPrice || req.query.maxPrice) {
                    filter.basePrice = {};
                    if (req.query.minPrice) filter.basePrice.$gte = Number(req.query.minPrice);
                    if (req.query.maxPrice) filter.basePrice.$lte = Number(req.query.maxPrice);
                }

                // ---------------- ✅ Duration ফিল্টার (নতুন) ----------------
                // "1-3", "4-6", "7+" এই ফরম্যাটে ফ্রন্টএন্ড থেকে আসবে
                if (req.query.duration) {
                    const durationRanges = {
                        "1-3": { $gte: 1, $lte: 3 },
                        "4-6": { $gte: 4, $lte: 6 },
                        "7+": { $gte: 7 },
                    };
                    const range = durationRanges[req.query.duration];
                    if (range) {
                        filter.durationDays = range;
                    }
                }

                const sortMap = {
                    newest: { createdAt: -1 },
                    priceLowToHigh: { basePrice: 1 },
                    priceHighToLow: { basePrice: -1 },
                };
                const sort = sortMap[req.query.sort] || sortMap.newest;

                const result = await TourPackageCollection.find(filter)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                const totalItems = await TourPackageCollection.countDocuments(filter);

                const totalPages = Math.ceil(totalItems / limit) || 1;
                const hasMore = page < totalPages;

                res.status(200).json({
                    success: true,
                    data: result,
                    pagination: {
                        currentPage: page,
                        totalPages,
                        totalItems,
                        limit,
                        hasMore,
                    },
                });
            } catch (error) {
                console.error("GET /api/packages error:", error);
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch packages",
                });
            }
        });

        // ---------------- ✅ ক্যাটাগরি লিস্ট (dropdown এর জন্য, distinct values) ----------------
        app.get("/api/packages/categories", async (req, res) => {
            try {
                const categories = await TourPackageCollection.distinct("category", {
                    status: "published",
                });
                res.status(200).json({ success: true, data: categories });
            } catch (error) {
                console.error("GET /api/packages/categories error:", error);
                res.status(500).json({ success: false, message: "Failed to fetch categories" });
            }
        });

        // no need jwt verification for now, because this is just a test project and not a production-ready application. In a real-world scenario, you would implement proper authentication and authorization mechanisms.
        app.get("/api/agency/packages/:id", async (req, res) => {
            try {
                const { id } = req.params;
                console.log("Fetching package details for id:", id);
                // if (!ObjectId.isValid(id)) {
                //     return res.status(400).send({
                //         success: false,
                //         message: "Invalid package id",
                //     });
                // }

                const packageDetails = await TourPackageCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!packageDetails) {
                    return res.status(404).send({
                        success: false,
                        message: "Package not found",
                    });
                }

                res.send({
                    success: true,
                    data: packageDetails,
                });
            } catch (error) {
                console.error("Error fetching package details:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch package details",
                    error: error.message,
                });
            }
        });


        app.patch("/api/agency/packages/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;
                const { userid } = req.body;
                const { userstatus } = req.body;
                if (!userid || !userstatus !== "approved") {
                    return res.status(400).send({
                        success: false,
                        message: "Only approved agencies can update package status",
                    });
                }
                const allowedStatuses = ["published", "unpublished", "draft"];
                if (!status || !allowedStatuses.includes(status)) {
                    return res.status(400).send({
                        success: false,
                        message: `status must be one of: ${allowedStatuses.join(", ")}`,
                    });
                }

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid package id",
                    });
                }

                const result = await TourPackageCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Package not found",
                    });
                }

                res.send({
                    success: true,
                    message: `Status updated to ${status}`,
                });
            } catch (error) {
                console.error("Error updating package status:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update status",
                    error: error.message,
                });
            }
        });

        /**
         * DELETE /api/agency/packages/:id
         * প্যাকেজ পুরোপুরি ডিলিট করার জন্য
         */
        app.delete("/api/agency/packages/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid package id",
                    });
                }

                const result = await TourPackageCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                if (result.deletedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Package not found",
                    });
                }

                res.send({
                    success: true,
                    message: "Package deleted successfully",
                });
            } catch (error) {
                console.error("Error deleting package:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to delete package",
                    error: error.message,
                });
            }
        });

        /**
         * GET /api/agency/profile/:id
         * এজেন্সির প্রোফাইল ডাটা user collection থেকে ফেচ করে
         */
        app.get("/api/agency/profile/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid agency id",
                    });
                }

                const agency = await usersCollection.findOne({
                    _id: new ObjectId(id),
                    role: "agency",
                });

                if (!agency) {
                    return res.status(404).send({
                        success: false,
                        message: "Agency not found",
                    });
                }

                res.send({
                    success: true,
                    data: agency,
                });
            } catch (error) {
                console.error("Error fetching agency profile:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch profile",
                    error: error.message,
                });
            }
        });

        /**
         * PATCH /api/agency/profile/:id
         * Body: { name, phone, tradeLicense, operatingRegion, website, logoUrl, address, description }
         *
         * এজেন্সি নিজে যেসব ফিল্ড এডিট করতে পারবে শুধু সেগুলোই আপডেট হবে।
         * email, status, role, emailVerified — এগুলো এই এন্ডপয়েন্ট দিয়ে বদলানো যাবে না
         * (status শুধু admin verification API দিয়ে বদলাবে, email ফিক্সড)
         */
        app.patch("/api/agency/profile/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid agency id",
                    });
                }

                // শুধু whitelisted ফিল্ডগুলোই আপডেট হবে — email/status/role নিরাপদে সুরক্ষিত থাকবে
                const editableFields = [
                    "name",
                    "phone",
                    "tradeLicense",
                    "operatingRegion",
                    "website",
                    "logoUrl",
                    "address",
                    "description",
                ];

                const updateData = {};
                editableFields.forEach((field) => {
                    if (req.body[field] !== undefined) {
                        updateData[field] = req.body[field];
                    }
                });

                if (Object.keys(updateData).length === 0) {
                    return res.status(400).send({
                        success: false,
                        message: "No valid fields provided to update",
                    });
                }

                updateData.updatedAt = new Date();

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id), role: "agency" },
                    { $set: updateData }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Agency not found",
                    });
                }

                const updatedAgency = await usersCollection.findOne({
                    _id: new ObjectId(id),
                });

                res.send({
                    success: true,
                    message: "Profile updated successfully",
                    data: updatedAgency,
                });
            } catch (error) {
                console.error("Error updating agency profile:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update profile",
                    error: error.message,
                });
            }
        });

        //admin panel er jonno sob package dekhate hobe tai status filter lagbe na


        app.get("/api/admin/users", async (req, res) => {
            try {
                const {
                    role,
                    status = "pending",
                    search = "",
                    page = 1,
                    limit = 5,
                } = req.query;

                // role না দিলে এখানেই আটকে দিচ্ছি, যাতে ভুলে সব ইউজার (agency + traveler + admin) একসাথে না চলে আসে
                if (!role) {
                    return res.status(400).send({
                        success: false,
                        message: "role query param is required (e.g. role=agency or role=traveler)",
                    });
                }

                const query = { role, status };

                // সার্চ: email দিয়ে partial match, অথবা _id দিয়ে exact match
                if (search && search.trim() !== "") {
                    const trimmedSearch = search.trim();
                    const searchConditions = [
                        { email: { $regex: trimmedSearch, $options: "i" } },
                    ];

                    // যদি সার্চ স্ট্রিংটা একটা ভ্যালিড ObjectId হয়, তাহলে _id দিয়েও ম্যাচ করানো হবে
                    if (ObjectId.isValid(trimmedSearch)) {
                        searchConditions.push({ _id: new ObjectId(trimmedSearch) });
                    }

                    query.$or = searchConditions;
                }

                const skip = (Number(page) - 1) * Number(limit);

                const users = await usersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit))
                    .toArray();

                const total = await usersCollection.countDocuments(query);

                // Tabs এর পাশে count দেখানোর জন্য — role অনুযায়ী প্রতিটা status এর সংখ্যা
                // (নোট: সার্চ করলেও count গুলো role-ভিত্তিক পুরো ডাটাসেটের উপর ভিত্তি করে দেখানো হচ্ছে,
                // Tabs count যেন সার্চ টাইপ করার সময় লাফালাফি না করে)
                const statusCountsAgg = await usersCollection
                    .aggregate([
                        { $match: { role } },
                        { $group: { _id: "$status", count: { $sum: 1 } } },
                    ])
                    .toArray();

                const statusCounts = { pending: 0, approved: 0, rejected: 0 };
                statusCountsAgg.forEach((item) => {
                    statusCounts[item._id] = item.count;
                });

                res.send({
                    success: true,
                    data: users,
                    meta: {
                        total,
                        page: Number(page),
                        limit: Number(limit),
                        totalPages: Math.ceil(total / Number(limit)),
                    },
                    statusCounts,
                });
            } catch (error) {
                console.error("Error fetching admin users:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch users",
                    error: error.message,
                });
            }
        });

        app.patch("/api/admin/users/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                const allowedStatuses = ["pending", "approved", "rejected"];
                if (!status || !allowedStatuses.includes(status)) {
                    return res.status(400).send({
                        success: false,
                        message: `status must be one of: ${allowedStatuses.join(", ")}`,
                    });
                }

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid user id",
                    });
                }

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "User not found",
                    });
                }

                res.send({
                    success: true,
                    message: `Status updated to ${status}`,
                });
            } catch (error) {
                console.error("Error updating user status:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update status",
                    error: error.message,
                });
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