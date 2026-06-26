import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './components/authrouter.js';
import airouter from './components/airouter.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/',authRoutes);
app.use('/api/ai', airouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});