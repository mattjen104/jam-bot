import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes";
import { loreErrorHandler } from "./middlewares/asyncHandler.js";

const app: Express = express();

app.use(cors());
app.use(cookieParser());
// Library file imports can legitimately be multi-MB (50k-item JSON exports);
// everything else keeps the small default limit. The path check happens
// before parsing, so the big limit never applies to other routes.
const defaultJson = express.json();
const importFileJson = express.json({ limit: "25mb" });
app.use((req, res, next) =>
  req.path === "/api/me/library/import/file"
    ? importFileJson(req, res, next)
    : defaultJson(req, res, next),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(loreErrorHandler);

export default app;
