import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createStatsReporter } from './index.js';

const config = loadConfig();
const reporter = createStatsReporter(config.statsDbPath);
const outputPath = 'data/stats-summary.md';

await reporter.generateSummary(outputPath);
logger.info('Stats summary generated', { outputPath });
