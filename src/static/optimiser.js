// strategylab.js "Find best strategy" on a worker thread: whatif.js optimise over this worker's share of the plans
import {optimise} from './whatif.js';

onmessage = ({data: {M, id, opts}}) => postMessage(optimise(M, id, opts));
