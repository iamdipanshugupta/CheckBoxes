import Redis from "ioredis";

function createRedisConnection() {
    return new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
    });
}

export const redis = createRedisConnection();
export const publisher = createRedisConnection();
export const subscriber = createRedisConnection();

redis.on("error", (err) =>
    console.log("Redis Error:", err.message)
);

publisher.on("error", (err) =>
    console.log("Publisher Error:", err.message)
);

subscriber.on("error", (err) =>
    console.log("Subscriber Error:", err.message)
);