import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import novelRouter from "./novel.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(novelRouter);

export default router;
