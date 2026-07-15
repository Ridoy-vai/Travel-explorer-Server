import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion, ObjectId, Collection, Document } from "mongodb";

dotenv.config();

const app = express();

app.use(
    cors({
        origin: process.env.CLIENT_URI, // আপনার ফ্রন্টএন্ডের নির্দিষ্ট URL
        credentials: true, // ক্রেডেনশিয়াল বা কুকি সাপোর্ট অ্যালাউ করার জন্য
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI as string;

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
        // Connect the client to the server (optional starting in v4.7)
        await client.connect();
        const database = client.db("Travel-Explore");
        const TourPackageCollection: Collection<Document> = database.collection("TourPackages");
        const usersCollection: Collection<Document> = database.collection("user");
        const packagebookingCollection: Collection<Document> = database.collection("packageBookings");
        const inquiryCollection: Collection<Document> = database.collection("inquiries");
        // const bookingsCollection = database.collection("bookings");

        app.post("/api/agency/packages", async (req: Request, res: Response) => {
            console.log("Received request to add package:", req.body);
            try {
                const body = req.body;

                const required = [
                    "title", "destination", "category", "basePrice",
                    "coverImage", "agencyId", "tourStartDate", "tourEndDate", "pickupTime",
                ];
                const missing = required.filter((field) => body[field] === undefined || body[field] === "");
                if (missing.length) {
                    return res.status(400).json({
                        message: `Missing required field(s): ${missing.join(", ")}`,
                    });
                }

                // Normalize to date-only (midnight) — pickup time never affects duration.
                const startDate = new Date(body.tourStartDate);
                const endDate = new Date(body.tourEndDate);

                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    return res.status(400).json({ message: "Invalid trip start or end date." });
                }
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(0, 0, 0, 0);

                if (endDate <= startDate) {
                    return res.status(400).json({ message: "Trip end date must be after the start date." });
                }

                // Pickup time format check: "HH:MM"
                if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(body.pickupTime)) {
                    return res.status(400).json({ message: "Invalid pickup time format. Expected HH:MM." });
                }

                // Server re-derives duration from date-only difference — never trusts client value.
                const diffMs = endDate.getTime() - startDate.getTime();
                const durationNights = Math.round(diffMs / (1000 * 60 * 60 * 24));
                const durationDays = durationNights + 1;

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

                    durationDays,
                    durationNights,
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

                    tourStartDate: startDate,
                    tourEndDate: endDate,
                    pickupTime: body.pickupTime, // stored as "HH:MM" string

                    tags: body.tags || [],

                    status: body.status || "published",
                    createdAt: new Date(),
                };

                const result = await TourPackageCollection.insertOne(newPackageData);

                return res.status(201).json({
                    message: "Package published successfully.",
                    data: {
                        _id: result.insertedId,
                        ...newPackageData,
                    },
                });
            } catch (err: any) {
                console.error("Add package error:", err);
                return res.status(500).json({ message: "Something went wrong while saving the package." });
            }
        });

        // const TourPackageCollection = database.collection("TourPackages");

        app.get("/api/agency/packages", async (req: Request, res: Response) => {

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
                const packages = await TourPackageCollection.find(query as Document)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit))
                    .toArray();

                // মোট কতগুলো ম্যাচ করলো (pagination এর জন্য)
                const total = await TourPackageCollection.countDocuments(query as Document);

                // Tabs এর পাশে count দেখানোর জন্য প্রতিটা status এর সংখ্যা আলাদাভাবে বের করা
                const statusCountsAgg = await TourPackageCollection.aggregate([
                    { $match: { agencyId } },
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                ]).toArray();

                const statusCounts: Record<string, number> = { published: 0, unpublished: 0, draft: 0 };
                statusCountsAgg.forEach((item) => {
                    statusCounts[item._id as string] = item.count;
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
            } catch (error: any) {
                console.error("Error fetching agency packages:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch packages",
                    error: error.message,
                });
            }
        });


        // no need jwt verification for now, because this is just a test project and not a production-ready application. In a real-world scenario, you would implement proper authentication and authorization mechanisms.
        app.get("/api/packages", async (req: Request, res: Response) => {
            try {
                const page = Math.max(parseInt(req.query.page as string) || 1, 1);
                const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 12, 1), 50);
                const skip = (page - 1) * limit;

                const filter: Record<string, any> = { status: "published" };

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
                    const durationRanges: Record<string, any> = {
                        "1-3": { $gte: 1, $lte: 3 },
                        "4-6": { $gte: 4, $lte: 6 },
                        "7+": { $gte: 7 },
                    };
                    const range = durationRanges[req.query.duration as string];
                    if (range) {
                        filter.durationDays = range;
                    }
                }

                const sortMap: Record<string, any> = {
                    newest: { createdAt: -1 },
                    priceLowToHigh: { basePrice: 1 },
                    priceHighToLow: { basePrice: -1 },
                };
                const sort = sortMap[req.query.sort as string] || sortMap.newest;

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
            } catch (error: any) {
                console.error("GET /api/packages error:", error);
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch packages",
                });
            }
        });

        // ---------------- ✅ ক্যাটাগরি লিস্ট (dropdown এর জন্য, distinct values) ----------------
        app.get("/api/packages/categories", async (req: Request, res: Response) => {
            try {
                const categories = await TourPackageCollection.distinct("category", {
                    status: "published",
                });
                res.status(200).json({ success: true, data: categories });
            } catch (error: any) {
                console.error("GET /api/packages/categories error:", error);
                res.status(500).json({ success: false, message: "Failed to fetch categories" });
            }
        });

        app.get("/api/test", (req, res) => {
            res.send("API Test OK");
        });

        // no need jwt verification for now, because this is just a test project and not a production-ready application. In a real-world scenario, you would implement proper authentication and authorization mechanisms.
        app.get("/api/agency/packages/:id", async (req: Request, res: Response) => {
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
            } catch (error: any) {
                console.error("Error fetching package details:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch package details",
                    error: error.message,
                });
            }
        });

        app.patch("/api/agency/packages/:id/status", async (req: Request, res: Response) => {
            try {
                const { id } = req.params;
                const { newStatus, userid } = req.body; // userstatus আর client থেকে নেওয়া হচ্ছে না

                if (!userid) {
                    return res.status(400).send({
                        success: false,
                        message: "userid is required",
                    });
                }

                if (!ObjectId.isValid(userid)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid userid",
                    });
                }

                // ✅ ইউজারের আসল status DB থেকে নিজে verify করা হচ্ছে,
                // client-এর পাঠানো userstatus আর trust করা হচ্ছে না
                const currentUser = await usersCollection.findOne({
                    _id: new ObjectId(userid),
                });

                if (!currentUser || currentUser.status !== "approved") {
                    return res.status(403).send({
                        success: false,
                        message: "Only approved agencies can update package status",
                    });
                }

                const allowedStatuses = ["published", "unpublished", "draft"];
                if (!newStatus || !allowedStatuses.includes(newStatus)) {
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

                // (ঐচ্ছিক কিন্তু ভালো practice) এই প্যাকেজটা আসলেই এই এজেন্সির কিনা তাও চেক করা যায়:
                // const pkg = await TourPackageCollection.findOne({ _id: new ObjectId(id) });
                // if (!pkg || pkg.agencyId?.toString() !== userid) {
                //     return res.status(403).send({ success: false, message: "Not your package" });
                // }

                const result = await TourPackageCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status: newStatus,
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
                    message: `Status updated to ${newStatus}`,
                });
            } catch (error: any) {
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
        app.delete("/api/agency/packages/:id", async (req: Request, res: Response) => {
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
            } catch (error: any) {
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
        app.get("/api/agency/profile/:id", async (req: Request, res: Response) => {
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
            } catch (error: any) {
                console.error("Error fetching agency profile:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch profile",
                    error: error.message,
                });
            }
        });

        app.patch("/api/agency/profile/:id", async (req: Request, res: Response) => {
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

                const updateData: Record<string, any> = {};
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
            } catch (error: any) {
                console.error("Error updating agency profile:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update profile",
                    error: error.message,
                });
            }
        });

        //admin panel er jonno sob package dekhate hobe tai status filter lagbe na

        app.get("/api/admin/users", async (req: Request, res: Response) => {
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

                const query: Record<string, any> = { role, status };

                // সার্চ: email দিয়ে partial match, অথবা _id দিয়ে exact match
                if (search && (search as string).trim() !== "") {
                    const trimmedSearch = (search as string).trim();
                    const searchConditions: Record<string, any>[] = [
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

                const statusCounts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
                statusCountsAgg.forEach((item) => {
                    statusCounts[item._id as string] = item.count;
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
            } catch (error: any) {
                console.error("Error fetching admin users:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch users",
                    error: error.message,
                });
            }
        });

        app.patch("/api/admin/users/:id/status", async (req: Request, res: Response) => {
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
            } catch (error: any) {
                console.error("Error updating user status:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update status",
                    error: error.message,
                });
            }
        });

        app.post("/api/bookings", async (req: Request, res: Response) => {
            console.log("Received request to save booking:", req.body);
            try {
                const body = req.body;

                const required = ["sessionId", "packageId", "email"];
                const missing = required.filter((field) => !body[field]);
                if (missing.length) {
                    return res.status(400).json({
                        message: `Missing required field(s): ${missing.join(", ")}`,
                    });
                }

                // Duplicate guard — same sessionId already saved? Don't insert again.
                const existing = await packagebookingCollection.findOne({ sessionId: body.sessionId });
                if (existing) {
                    return res.status(200).json({
                        message: "Booking already recorded.",
                        data: existing,
                    });
                }

                const newBookingData = {
                    sessionId: body.sessionId,
                    invoiceId: body.invoiceId || body.sessionId,
                    packageId: body.packageId,
                    agencyId: body.agencyId,
                    travelers: body.travelerId,
                    email: body.email,
                    adultCount: Number(body.adultCount) || 0,
                    childCount: Number(body.childCount) || 0,
                    totalMale: Number(body.totalMale) || 0,
                    totalFemale: Number(body.totalFemale) || 0,
                    totalChildPrice: Number(body.totalChildPrice) || 0,
                    totalAmount: Number(body.totalAmount) || 0,
                    currency: body.currency || "usd",
                    status: "confirmed",
                    createdAt: new Date(),
                };

                const result = await packagebookingCollection.insertOne(newBookingData);

                return res.status(201).json({
                    message: "Booking saved successfully.",
                    data: {
                        _id: result.insertedId,
                        ...newBookingData,
                    },
                });
            } catch (err: any) {
                console.error("Save booking error:", err);
                return res.status(500).json({ message: "Something went wrong while saving the booking." });
            }
        });

        app.get("/api/agency/:agencyId/bookings-summary", async (req: Request, res: Response) => {
            try {
                const { agencyId } = req.params;

                const summary = await packagebookingCollection.aggregate([
                    { $match: { agencyId } },
                    {
                        $group: {
                            _id: "$packageId",
                            totalBookings: { $sum: 1 },
                            totalAdults: { $sum: { $ifNull: ["$adultCount", 0] } },
                            totalChildren: { $sum: { $ifNull: ["$childCount", 0] } },
                            totalRevenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            lastBookedAt: { $max: "$createdAt" },
                        },
                    },
                    {
                        $addFields: {
                            packageObjectId: { $toObjectId: "$_id" },
                        },
                    },
                    {
                        $lookup: {
                            from: "TourPackages",
                            localField: "packageObjectId",
                            foreignField: "_id",
                            as: "packageDetails",
                        },
                    },
                    { $unwind: { path: "$packageDetails", preserveNullAndEmptyArrays: true } },
                    { $sort: { totalBookings: -1 } },
                ]).toArray();

                return res.status(200).json({ data: summary });
            } catch (err: any) {
                console.error("Fetch booking summary error:", err);
                return res.status(500).json({ message: "Something went wrong while fetching summary." });
            }
        });

        app.get("/api/agency/:agencyId/earnings", async (req: Request, res: Response) => {
            try {
                const { agencyId } = req.params;

                const now = new Date();
                const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

                // Overall totals
                const totalsResult = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed" } },
                    {
                        $group: {
                            _id: null,
                            totalEarnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            totalBookings: { $sum: 1 },
                            totalTravelers: {
                                $sum: {
                                    $add: [
                                        { $ifNull: ["$adultCount", 0] },
                                        { $ifNull: ["$childCount", 0] },
                                    ],
                                },
                            },
                        },
                    },
                ]).toArray();

                const totals = totalsResult[0] || { totalEarnings: 0, totalBookings: 0, totalTravelers: 0 };

                // This month vs last month (for growth %)
                const [thisMonthResult, lastMonthResult] = await Promise.all([
                    packagebookingCollection.aggregate([
                        { $match: { agencyId, status: "confirmed", createdAt: { $gte: startOfThisMonth } } },
                        { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", 0] } }, count: { $sum: 1 } } },
                    ]).toArray(),
                    packagebookingCollection.aggregate([
                        { $match: { agencyId, status: "confirmed", createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth } } },
                        { $group: { _id: null, total: { $sum: { $ifNull: ["$totalAmount", 0] } }, count: { $sum: 1 } } },
                    ]).toArray(),
                ]);

                const thisMonthEarnings = (thisMonthResult[0] as any)?.total || 0;
                const lastMonthEarnings = (lastMonthResult[0] as any)?.total || 0;
                const growthPercent = lastMonthEarnings > 0
                    ? (((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100).toFixed(1)
                    : thisMonthEarnings > 0 ? 100 : 0;

                // Monthly trend, last 6 months
                const monthlyTrend = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed", createdAt: { $gte: sixMonthsAgo } } },
                    {
                        $group: {
                            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
                            earnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            bookings: { $sum: 1 },
                        },
                    },
                    { $sort: { "_id.year": 1, "_id.month": 1 } },
                ]).toArray();

                // Earnings by package
                const earningsByPackage = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed" } },
                    {
                        $group: {
                            _id: "$packageId",
                            earnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            bookings: { $sum: 1 },
                        },
                    },
                    { $addFields: { packageObjectId: { $toObjectId: "$_id" } } },
                    {
                        $lookup: {
                            from: "TourPackages",
                            localField: "packageObjectId",
                            foreignField: "_id",
                            as: "packageDetails",
                        },
                    },
                    { $unwind: { path: "$packageDetails", preserveNullAndEmptyArrays: true } },
                    { $sort: { earnings: -1 } },
                ]).toArray();

                // Recent transactions
                const recentTransactions = await packagebookingCollection
                    .find({ agencyId, status: "confirmed" })
                    .sort({ createdAt: -1 })
                    .limit(10)
                    .toArray();

                return res.status(200).json({
                    data: {
                        totalEarnings: totals.totalEarnings,
                        totalBookings: totals.totalBookings,
                        totalTravelers: totals.totalTravelers,
                        thisMonthEarnings,
                        lastMonthEarnings,
                        growthPercent,
                        monthlyTrend,
                        earningsByPackage,
                        recentTransactions,
                    },
                });
            } catch (err: any) {
                console.error("Fetch earnings error:", err);
                return res.status(500).json({ message: "Something went wrong while fetching earnings." });
            }
        });

        app.get("/api/agency/:agencyId/overview", async (req: Request, res: Response) => {
            try {
                const { agencyId } = req.params;

                const now = new Date();
                const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

                // Package stats
                const [totalPackages, publishedPackages, draftPackages] = await Promise.all([
                    TourPackageCollection.countDocuments({ agencyId }),
                    TourPackageCollection.countDocuments({ agencyId, status: "published" }),
                    TourPackageCollection.countDocuments({ agencyId, status: { $ne: "published" } }),
                ]);

                // Booking + earnings totals
                const totalsResult = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed" } },
                    {
                        $group: {
                            _id: null,
                            totalEarnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            totalBookings: { $sum: 1 },
                            totalTravelers: {
                                $sum: {
                                    $add: [
                                        { $ifNull: ["$adultCount", 0] },
                                        { $ifNull: ["$childCount", 0] },
                                    ],
                                },
                            },
                        },
                    },
                ]).toArray();
                const totals = totalsResult[0] || { totalEarnings: 0, totalBookings: 0, totalTravelers: 0 };

                // This month earnings + bookings
                const thisMonthResult = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed", createdAt: { $gte: startOfThisMonth } } },
                    {
                        $group: {
                            _id: null,
                            earnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            bookings: { $sum: 1 },
                        },
                    },
                ]).toArray();
                const thisMonth = thisMonthResult[0] || { earnings: 0, bookings: 0 };

                // Top 3 performing packages
                const topPackages = await packagebookingCollection.aggregate([
                    { $match: { agencyId, status: "confirmed" } },
                    {
                        $group: {
                            _id: "$packageId",
                            earnings: { $sum: { $ifNull: ["$totalAmount", 0] } },
                            bookings: { $sum: 1 },
                        },
                    },
                    { $sort: { earnings: -1 } },
                    { $limit: 3 },
                    { $addFields: { packageObjectId: { $toObjectId: "$_id" } } },
                    {
                        $lookup: {
                            from: "TourPackages",
                            localField: "packageObjectId",
                            foreignField: "_id",
                            as: "packageDetails",
                        },
                    },
                    { $unwind: { path: "$packageDetails", preserveNullAndEmptyArrays: true } },
                ]).toArray();

                // Recent 5 bookings
                const recentBookings = await packagebookingCollection
                    .find({ agencyId, status: "confirmed" })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .toArray();

                // Attach package title to recent bookings
                const recentPackageIds = [...new Set(recentBookings.map((b: any) => b.packageId))];
                const recentPackagesDocs = await TourPackageCollection.find({
                    _id: { $in: recentPackageIds.map((id: any) => new ObjectId(id)) },
                }).toArray();
                const packageTitleMap = Object.fromEntries(
                    recentPackagesDocs.map((p: any) => [p._id.toString(), p.title])
                );
                const recentBookingsWithTitle = recentBookings.map((b: any) => ({
                    ...b,
                    packageTitle: packageTitleMap[b.packageId] || "Unknown package",
                }));

                return res.status(200).json({
                    data: {
                        totalPackages,
                        publishedPackages,
                        draftPackages,
                        totalEarnings: totals.totalEarnings,
                        totalBookings: totals.totalBookings,
                        totalTravelers: totals.totalTravelers,
                        thisMonthEarnings: thisMonth.earnings,
                        thisMonthBookings: thisMonth.bookings,
                        topPackages,
                        recentBookings: recentBookingsWithTitle,
                    },
                });
            } catch (err: any) {
                console.error("Fetch overview error:", err);
                return res.status(500).json({ message: "Something went wrong while fetching overview." });
            }
        });

        // 1. Create inquiry (customer-facing)
        app.post("/api/inquiries", async (req: Request, res: Response) => {
            try {
                const body = req.body;

                const required = ["name", "email", "phone", "packageId", "agencyId"];
                const missing = required.filter((field) => !body[field]);
                if (missing.length) {
                    return res.status(400).json({
                        message: `Missing required field(s): ${missing.join(", ")}`,
                    });
                }

                const newInquiry = {
                    agencyId: body.agencyId,
                    packageId: body.packageId,
                    name: body.name,
                    email: body.email,
                    phone: body.phone,
                    message: body.message || "",
                    status: "new", // new | contacted | closed
                    createdAt: new Date(),
                };

                const result = await inquiryCollection.insertOne(newInquiry);

                return res.status(201).json({
                    message: "Inquiry submitted successfully.",
                    data: { _id: result.insertedId, ...newInquiry },
                });
            } catch (err: any) {
                console.error("Create inquiry error:", err);
                return res.status(500).json({ message: "Something went wrong while submitting inquiry." });
            }
        });

        // 2. List inquiries for an agency (dashboard)
        app.get("/api/agency/:agencyId/inquiries", async (req: Request, res: Response) => {
            try {
                const { agencyId } = req.params;
                const { status } = req.query; // optional filter: new | contacted | closed

                const filter: Record<string, any> = { agencyId };
                if (status) filter.status = status;

                const inquiries = await inquiryCollection
                    .find(filter)
                    .sort({ createdAt: -1 })
                    .toArray();

                // Attach package title
                const packageIds = [...new Set(inquiries.map((i: any) => i.packageId))];
                const packages = await TourPackageCollection.find({
                    _id: { $in: packageIds.map((id: any) => new ObjectId(id)) },
                }).toArray();
                const titleMap = Object.fromEntries(packages.map((p: any) => [p._id.toString(), p.title]));

                const enriched = inquiries.map((i: any) => ({
                    ...i,
                    packageTitle: titleMap[i.packageId] || "Unknown package",
                }));

                return res.status(200).json({ data: enriched });
            } catch (err: any) {
                console.error("Fetch inquiries error:", err);
                return res.status(500).json({ message: "Something went wrong while fetching inquiries." });
            }
        });

        // 3. Update inquiry status
        app.patch("/api/inquiries/:id/status", async (req: Request, res: Response) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                const validStatuses = ["new", "contacted", "closed"];
                if (!validStatuses.includes(status)) {
                    return res.status(400).json({ message: "Invalid status value." });
                }

                const result = await inquiryCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status, updatedAt: new Date() } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Inquiry not found." });
                }

                return res.status(200).json({ message: "Status updated." });
            } catch (err: any) {
                console.error("Update inquiry status error:", err);
                return res.status(500).json({ message: "Something went wrong while updating status." });
            }
        });

        app.get("/api/travelers/:travelerId/bookings", async (req: Request, res: Response) => {
            try {
                const { travelerId } = req.params;

                const bookings = await packagebookingCollection
                    .find({ travelers: travelerId })
                    .sort({ createdAt: -1 })
                    .toArray();

                if (!bookings.length) {
                    return res.status(200).json({ data: [] });
                }

                // Attach package details
                const packageIds = [...new Set(bookings.map((b: any) => b.packageId))];
                const packages = await TourPackageCollection.find({
                    _id: { $in: packageIds.map((id: any) => new ObjectId(id)) },
                }).toArray();
                const packageMap = Object.fromEntries(
                    packages.map((p: any) => [p._id.toString(), p])
                );

                const enriched = bookings.map((b: any) => ({
                    ...b,
                    packageDetails: packageMap[b.packageId] || null,
                }));

                return res.status(200).json({ data: enriched });
            } catch (err: any) {
                console.error("Fetch traveler bookings error:", err);
                return res.status(500).json({ message: "Something went wrong while fetching bookings." });
            }
        });

        app.get("/api/travelers/:travelerId/dashboard-overview", async (req: Request, res: Response) => {
            try {
                const { travelerId } = req.params;

                // Join bookings -> TourPackages in one aggregation instead of
                // doing a separate find() + in-memory map like the bookings route.
                const bookings = await packagebookingCollection
                    .aggregate([
                        { $match: { travelers: travelerId } },
                        {
                            $addFields: {
                                packageObjectId: { $toObjectId: "$packageId" },
                            },
                        },
                        {
                            $lookup: {
                                from: "TourPackages",
                                localField: "packageObjectId",
                                foreignField: "_id",
                                as: "packageDetails",
                            },
                        },
                        {
                            $unwind: {
                                path: "$packageDetails",
                                preserveNullAndEmptyArrays: true,
                            },
                        },
                        { $sort: { createdAt: -1 } },
                    ])
                    .toArray();

                if (!bookings.length) {
                    const now = new Date();
                    const emptyTrend: { month: string; spent: number }[] = [];
                    for (let i = 5; i >= 0; i--) {
                        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                        emptyTrend.push({
                            month: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
                            spent: 0,
                        });
                    }
                    return res.status(200).json({
                        data: {
                            stats: {
                                totalTrips: 0,
                                totalSpent: 0,
                                currency: "usd",
                                uniqueDestinations: 0,
                                upcomingCount: 0,
                            },
                            spendingTrend: emptyTrend,
                            categoryBreakdown: [],
                            upcomingTrips: [],
                            recentBookings: [],
                        },
                    });
                }

                const now = new Date();
                const currency = (bookings[0] as any).currency || "usd";

                // ---------------- Stats ----------------
                const totalTrips = bookings.length;
                // NOTE: totalAmount assumed to be in the smallest currency unit
                // (Stripe-style cents). If it's already a whole-currency value,
                // remove the "/ 100" wherever amounts are used below.
                const totalSpent = bookings.reduce((sum: number, b: any) => sum + (b.totalAmount || 0), 0);

                const uniqueDestinations = new Set(
                    bookings.map(
                        (b: any) => b.packageDetails?.title || b.packageDetails?.destination || b.packageId
                    )
                ).size;

                const isUpcoming = (b: any) =>
                    b.status === "confirmed" &&
                    b.packageDetails?.tourStartDate &&
                    new Date(b.packageDetails.tourStartDate) >= now;

                const upcomingCount = bookings.filter(isUpcoming).length;

                // ---------------- Spending trend (fixed last-6-months range) ----------------
                // Always emit 6 points (even with 0 spend) so the line chart on the
                // frontend has enough points to draw an actual line, not just a dot.
                const trendMap = new Map<string, number>();
                bookings.forEach((b: any) => {
                    const key = new Date(b.createdAt).toLocaleString("en-US", {
                        month: "short",
                        year: "2-digit",
                    });
                    trendMap.set(key, (trendMap.get(key) || 0) + (b.totalAmount || 0));
                });

                const spendingTrend: { month: string; spent: number }[] = [];
                for (let i = 5; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const key = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
                    spendingTrend.push({ month: key, spent: trendMap.get(key) || 0 });
                }

                // ---------------- Category breakdown ----------------
                const categoryMap = new Map<string, number>();
                bookings.forEach((b: any) => {
                    const cat = b.packageDetails?.category || "Other";
                    categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
                });
                const categoryBreakdown = Array.from(categoryMap.entries()).map(([name, value]) => ({
                    name,
                    value,
                }));

                // ---------------- Upcoming trips (confirmed + future tourStartDate) ----------------
                const upcomingTrips = bookings
                    .filter(isUpcoming)
                    .sort((a: any, b: any) => {
                        const aDate = new Date(a.packageDetails?.tourStartDate ?? 0).getTime();
                        const bDate = new Date(b.packageDetails?.tourStartDate ?? 0).getTime();
                        return aDate - bDate;
                    })
                    .slice(0, 4)
                    .map((b: any) => ({
                        _id: b._id,
                        destination: b.packageDetails?.title || b.packageDetails?.destination || "Untitled Package",
                        image: b.packageDetails?.coverImage || null,
                        tourStartDate: b.packageDetails?.tourStartDate || null,
                        tourEndDate: b.packageDetails?.tourEndDate || null,
                        travelers: (b.adultCount || 0) + (b.childCount || 0),
                        status: b.status,
                    }));

                // ---------------- Recent bookings (latest 6) ----------------
                const recentBookings = bookings.slice(0, 6).map((b: any) => ({
                    _id: b._id,
                    destination: b.packageDetails?.title || b.packageDetails?.destination || "Untitled Package",
                    bookedOn: b.createdAt,
                    amount: b.totalAmount,
                    currency: b.currency,
                    status: b.status,
                }));

                return res.status(200).json({
                    data: {
                        stats: {
                            totalTrips,
                            totalSpent,
                            currency,
                            uniqueDestinations,
                            upcomingCount,
                        },
                        spendingTrend,
                        categoryBreakdown,
                        upcomingTrips,
                        recentBookings,
                    },
                });
            } catch (err: any) {
                console.error("Fetch traveler dashboard overview error:", err);
                return res
                    .status(500)
                    .json({ message: "Something went wrong while fetching dashboard overview." });
            }
        });

        // usersCollection = database.collection("user");  // আগে থেকে define করা থাকলে এই লাইন লাগবে না

        // ============================================================
        // PATCH /api/traveler/profile/:travelerId
        // name, phone, and avatarUrl are editable here — email, role,
        // status, emailVerified stay server-controlled and are ignored
        // even if sent in the body.
        // ============================================================
        app.patch("/api/traveler/profile/:travelerId", async (req: Request, res: Response) => {
            try {
                const { travelerId } = req.params;
                const { name, phone, avatarUrl } = req.body;

                if (!ObjectId.isValid(travelerId)) {
                    return res.status(400).json({ success: false, message: "Invalid traveler id." });
                }

                if (!name || !phone) {
                    return res
                        .status(400)
                        .json({ success: false, message: "Name and phone are required." });
                }

                const updateFields: Record<string, any> = {
                    name,
                    phone,
                    updatedAt: new Date(),
                };

                // avatarUrl ঐচ্ছিক — পাঠানো হলে তবেই সেভ হবে
                if (avatarUrl) {
                    updateFields.avatarUrl = avatarUrl;
                }

                const updateResult = await usersCollection.findOneAndUpdate(
                    { _id: new ObjectId(travelerId), role: "traveler" },
                    { $set: updateFields },
                    { returnDocument: "after" }
                );

                if (!updateResult) {
                    return res.status(404).json({ success: false, message: "Traveler not found." });
                }

                return res.status(200).json({ success: true, data: updateResult });
            } catch (err: any) {
                console.error("Update traveler profile error:", err);
                return res
                    .status(500)
                    .json({ success: false, message: "Something went wrong while saving changes." });
            }
        });

        // ---- Get travelers (paginated) ----
        app.get("/api/admin/allusers/alltravelers", async (req: Request, res: Response) => {
            try {
                const page = Math.max(parseInt(req.query.page as string) || 1, 1);
                const limit = Math.max(parseInt(req.query.limit as string) || 10, 1);
                const skip = (page - 1) * limit;

                const [users, total] = await Promise.all([
                    usersCollection
                        .find({ role: "traveler" }, { projection: { password: 0 } })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    usersCollection.countDocuments({ role: "traveler" }),
                ]);

                res.status(200).json({
                    success: true,
                    data: { users, total, page, limit, totalPages: Math.ceil(total / limit) },
                });
            } catch (err: any) {
                console.error("Fetch travelers error:", err);
                res.status(500).json({ success: false, message: "Something went wrong while fetching travelers." });
            }
        });

        // ---- Get agencies (paginated) ----
        app.get("/api/admin/allusers/allagencies", async (req: Request, res: Response) => {
            try {
                const page = Math.max(parseInt(req.query.page as string) || 1, 1);
                const limit = Math.max(parseInt(req.query.limit as string) || 10, 1);
                const skip = (page - 1) * limit;

                const [users, total] = await Promise.all([
                    usersCollection
                        .find({ role: "agency" }, { projection: { password: 0 } })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    usersCollection.countDocuments({ role: "agency" }),
                ]);

                res.status(200).json({
                    success: true,
                    data: { users, total, page, limit, totalPages: Math.ceil(total / limit) },
                });
            } catch (err: any) {
                console.error("Fetch agencies error:", err);
                res.status(500).json({ success: false, message: "Something went wrong while fetching agencies." });
            }
        });

        // ---- Change role ----
        app.patch("/api/admin/allusers/:id/role", async (req: Request, res: Response) => {
            try {
                const { id } = req.params;
                const { role } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid user id." });
                }

                const allowedRoles = ["traveler", "agency", "admin"];
                if (!allowedRoles.includes(role)) {
                    return res.status(400).json({ success: false, message: "Invalid role." });
                }

                const result = await usersCollection.findOneAndUpdate(
                    { _id: new ObjectId(id) },
                    { $set: { role } },
                    { returnDocument: "after", projection: { password: 0 } }
                );

                if (!result) {
                    return res.status(404).json({ success: false, message: "User not found." });
                }

                res.status(200).json({ success: true, message: "Role updated successfully.", data: result });
            } catch (err: any) {
                console.error("Update role error:", err);
                res.status(500).json({ success: false, message: "Something went wrong while updating role." });
            }
        });

        // ---- Block / Unblock ----
        app.patch("/api/admin/allusers/:id/status", async (req: Request, res: Response) => {
            try {
                const { id } = req.params;
                const { status } = req.body; // "active" | "blocked"

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid user id." });
                }

                if (!["active", "blocked"].includes(status)) {
                    return res.status(400).json({ success: false, message: "Invalid status." });
                }

                const result = await usersCollection.findOneAndUpdate(
                    { _id: new ObjectId(id) },
                    { $set: { status } },
                    { returnDocument: "after", projection: { password: 0 } }
                );

                if (!result) {
                    return res.status(404).json({ success: false, message: "User not found." });
                }

                res.status(200).json({
                    success: true,
                    message: `User ${status === "blocked" ? "blocked" : "unblocked"} successfully.`,
                    data: result,
                });
            } catch (err: any) {
                console.error("Update status error:", err);
                res.status(500).json({ success: false, message: "Something went wrong while updating status." });
            }
        });

        // ---- Delete user ----
        app.delete("/api/admin/allusers/:id", async (req: Request, res: Response) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid user id." });
                }

                const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: "User not found." });
                }

                res.status(200).json({ success: true, message: "User deleted successfully." });
            } catch (err: any) {
                console.error("Delete user error:", err);
                res.status(500).json({ success: false, message: "Something went wrong while deleting user." });
            }
        });

        // Add this alongside your other admin routes.
        // Assumes: usersCollection, TourPackageCollection, packagebookingCollection
        // are already defined (as in your existing file), e.g.:
        //   const usersCollection = database.collection("user");
        //   const TourPackageCollection = database.collection("TourPackages");
        //   const packagebookingCollection = database.collection("packageBookings");

        app.get("/api/admin/overview", async (req: Request, res: Response) => {
            try {
                const [
                    usersByRole,
                    packagesByStatus,
                    packagesByCategory,
                    bookingsByStatus,
                    revenueByMonthAgg,
                    totalUsers,
                    totalPackages,
                    totalBookings,
                    totalRevenueAgg,
                    recentBookings,
                ] = await Promise.all([
                    usersCollection
                        .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
                        .toArray(),

                    TourPackageCollection
                        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
                        .toArray(),

                    TourPackageCollection
                        .aggregate([
                            { $group: { _id: "$category", count: { $sum: 1 } } },
                            { $sort: { count: -1 } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
                        .toArray(),

                    // Revenue trend — only counts confirmed bookings
                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            {
                                $group: {
                                    _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
                                    revenue: { $sum: "$totalAmount" },
                                    bookings: { $sum: 1 },
                                },
                            },
                            { $sort: { "_id.year": 1, "_id.month": 1 } },
                        ])
                        .toArray(),

                    usersCollection.countDocuments({}),
                    TourPackageCollection.countDocuments({}),
                    packagebookingCollection.countDocuments({}),

                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            { $group: { _id: null, total: { $sum: "$totalAmount" } } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .find({})
                        .sort({ createdAt: -1 })
                        .limit(5)
                        .toArray(),
                ]);

                const monthNames = [
                    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                ];

                res.status(200).json({
                    success: true,
                    data: {
                        totals: {
                            users: totalUsers,
                            packages: totalPackages,
                            bookings: totalBookings,
                            revenue: (totalRevenueAgg[0] as any)?.total || 0,
                        },
                        usersByRole: usersByRole.map((u: any) => ({
                            role: u._id || "unknown",
                            count: u.count,
                        })),
                        packagesByStatus: packagesByStatus.map((p: any) => ({
                            status: p._id || "unknown",
                            count: p.count,
                        })),
                        packagesByCategory: packagesByCategory.map((c: any) => ({
                            category: c._id || "Uncategorized",
                            count: c.count,
                        })),
                        bookingsByStatus: bookingsByStatus.map((b: any) => ({
                            status: b._id || "unknown",
                            count: b.count,
                        })),
                        revenueByMonth: revenueByMonthAgg.map((r: any) => ({
                            month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
                            revenue: r.revenue,
                            bookings: r.bookings,
                        })),
                        recentBookings: recentBookings.map((b: any) => ({
                            _id: b._id,
                            email: b.email,
                            totalAmount: b.totalAmount,
                            currency: b.currency,
                            status: b.status,
                            createdAt: b.createdAt,
                        })),
                    },
                });
            } catch (err: any) {
                console.error("Admin overview error:", err);
                res.status(500).json({
                    success: false,
                    message: "Something went wrong while loading the overview.",
                });
            }
        });

        // Add this alongside your other admin routes.
        // Assumes: usersCollection, TourPackageCollection, packagebookingCollection
        // are already defined, e.g.:
        //   const usersCollection = database.collection("user");
        //   const TourPackageCollection = database.collection("TourPackages");
        //   const packagebookingCollection = database.collection("packageBookings");

        // ---- Finance summary (stat cards + charts) ----
        app.get("/api/admin/finance/summary", async (req: Request, res: Response) => {
            try {
                const [
                    confirmedAgg,
                    avgAgg,
                    statusCounts,
                    revenueByMonthAgg,
                    revenueByAgencyAgg,
                ] = await Promise.all([
                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            { $group: { _id: null, avg: { $avg: "$totalAmount" } } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .aggregate([
                            { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$totalAmount" } } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            {
                                $group: {
                                    _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
                                    revenue: { $sum: "$totalAmount" },
                                    bookings: { $sum: 1 },
                                },
                            },
                            { $sort: { "_id.year": 1, "_id.month": 1 } },
                        ])
                        .toArray(),

                    packagebookingCollection
                        .aggregate([
                            { $match: { status: "confirmed" } },
                            {
                                $addFields: {
                                    packageObjId: {
                                        $convert: { input: "$packageId", to: "objectId", onError: null, onNull: null },
                                    },
                                },
                            },
                            {
                                $lookup: {
                                    from: "TourPackages",
                                    localField: "packageObjId",
                                    foreignField: "_id",
                                    as: "packageInfo",
                                },
                            },
                            { $unwind: { path: "$packageInfo", preserveNullAndEmptyArrays: true } },
                            {
                                $group: {
                                    _id: { $ifNull: ["$packageInfo.agencyName", "Unknown Agency"] },
                                    revenue: { $sum: "$totalAmount" },
                                    bookings: { $sum: 1 },
                                },
                            },
                            { $sort: { revenue: -1 } },
                            { $limit: 8 },
                        ])
                        .toArray(),
                ]);

                const monthNames = [
                    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                ];

                const pending: any = statusCounts.find((s: any) => s._id === "pending");

                res.status(200).json({
                    success: true,
                    data: {
                        totalRevenue: (confirmedAgg[0] as any)?.total || 0,
                        confirmedCount: (confirmedAgg[0] as any)?.count || 0,
                        avgBookingValue: (avgAgg[0] as any)?.avg || 0,
                        pendingAmount: pending?.amount || 0,
                        pendingCount: pending?.count || 0,
                        statusBreakdown: statusCounts.map((s: any) => ({
                            status: s._id || "unknown",
                            count: s.count,
                            amount: s.amount,
                        })),
                        revenueByMonth: revenueByMonthAgg.map((r: any) => ({
                            month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
                            revenue: r.revenue,
                            bookings: r.bookings,
                        })),
                        revenueByAgency: revenueByAgencyAgg.map((a: any) => ({
                            agency: a._id,
                            revenue: a.revenue,
                            bookings: a.bookings,
                        })),
                    },
                });
            } catch (err: any) {
                console.error("Finance summary error:", err);
                res.status(500).json({
                    success: false,
                    message: "Something went wrong while loading the finance summary.",
                });
            }
        });

        // ---- Transactions (paginated, filterable, searchable) ----
        app.get("/api/admin/finance/transactions", async (req: Request, res: Response) => {
            try {
                const page = Math.max(parseInt(req.query.page as string) || 1, 1);
                const limit = Math.max(parseInt(req.query.limit as string) || 10, 1);
                const skip = (page - 1) * limit;
                const { status, search } = req.query;

                const match: Record<string, any> = {};
                if (status && status !== "all") {
                    match.status = status;
                }
                if (search) {
                    match.$or = [
                        { email: { $regex: search, $options: "i" } },
                        { invoiceId: { $regex: search, $options: "i" } },
                    ];
                }

                const pipeline = [
                    { $match: match },
                    { $sort: { createdAt: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $addFields: {
                            packageObjId: {
                                $convert: { input: "$packageId", to: "objectId", onError: null, onNull: null },
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: "TourPackages",
                            localField: "packageObjId",
                            foreignField: "_id",
                            as: "packageInfo",
                        },
                    },
                    { $unwind: { path: "$packageInfo", preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            invoiceId: 1,
                            sessionId: 1,
                            email: 1,
                            totalAmount: 1,
                            currency: 1,
                            status: 1,
                            createdAt: 1,
                            adultCount: 1,
                            childCount: 1,
                            packageTitle: { $ifNull: ["$packageInfo.title", "Unknown package"] },
                            agencyName: { $ifNull: ["$packageInfo.agencyName", "Unknown agency"] },
                        },
                    },
                ];

                const [transactions, total] = await Promise.all([
                    packagebookingCollection.aggregate(pipeline).toArray(),
                    packagebookingCollection.countDocuments(match),
                ]);

                res.status(200).json({
                    success: true,
                    data: {
                        transactions,
                        total,
                        page,
                        limit,
                        totalPages: Math.ceil(total / limit),
                    },
                });
            } catch (err: any) {
                console.error("Fetch transactions error:", err);
                res.status(500).json({
                    success: false,
                    message: "Something went wrong while fetching transactions.",
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


app.get("/", (req: Request, res: Response) => {
    res.send("Travel-Bd is running!");
});

// লোকাল ডেভেলপমেন্টের জন্য listen রাখুন, Vercel (production) এ শুধু export হবে
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => console.log(`Server running on port ${port}`));
}

export default app;