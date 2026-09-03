import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createStatsReporter } from './index.js';

const config = loadConfig();
const reporter = createStatsReporter(config.statsDbPath);
const outputPath = 'data/stats-analysis.md';

await reporter.generateAnalysis(outputPath);
logger.info('Stats analysis generated', { outputPath });
