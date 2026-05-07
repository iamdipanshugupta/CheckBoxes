import Redis from "ioredis";

function createRedisConnection() {
    return new Redis ({
        host: 'localhost',
        port: 6379
    });
}

export const redis = createRedisConnection();
export const publisher = createRedisConnection();
export const subscriber = createRedisConnection();

// error handling (VERY IMPORTANT)
redis.on("error", (err) => console.log("Redis Error:", err.message));
publisher.on("error", (err) => console.log("Publisher Error:", err.message));
subscriber.on("error", (err) => console.log("Subscriber Error:", err.message)); 