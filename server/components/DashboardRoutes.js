import { Router } from "express";
import pg from "pg";

const {Pool} = pg;
const router = Router();

const pool = new Pool({});