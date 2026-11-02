// Runs before any module import (jest `setupFiles`), so env.ts sees a valid
// configuration. Keep this independent of a running database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://arl:arl@localhost:5432/arl";
process.env.ARL_API_ADDRESS = process.env.ARL_API_ADDRESS ?? "http://localhost";
process.env.ARL_API_PORT = process.env.ARL_API_PORT ?? "8080";
process.env.MQTT_BROKER_ADDRESS = process.env.MQTT_BROKER_ADDRESS ?? "localhost";
process.env.MQTT_BROKER_PORT = process.env.MQTT_BROKER_PORT ?? "1883";
