import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createStatsReporter } from './index.js';

const taskIdArg = process.argv[2];
const taskId = taskIdArg !== undefined ? Number(taskIdArg) : NaN;
if (!Number.isInteger(taskId)) {
  logger.error('Stats timeline: expected a task id argument, e.g. `npm run stats:timeline -- 42`', { taskIdArg });
  process.exit(1);
}

const config = loadConfig();
const reporter = createStatsReporter(config.statsDbPath);
const outputPath = `data/stats-timeline-${taskId}.md`;

await reporter.generateTimeline(taskId, outputPath);
logger.info('Stats timeline generated', { taskId, outputPath });
