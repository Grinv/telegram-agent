import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createStatsReporter } from './index.js';

const config = loadConfig();
const reporter = createStatsReporter(config.statsDbPath);
const outputPath = 'data/stats-report.md';

await reporter.generateReport(outputPath);
logger.info('Stats report generated', { outputPath });
