/** Load local env for integration tests (Compose DATABASE_URL, etc.). */
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });
