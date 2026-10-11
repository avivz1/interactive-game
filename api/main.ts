// Single Vercel Function for all /api/* routes (vercel.json rewrites them here).
import { nodeHandler } from '../server/http.js';

export default nodeHandler;
