import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/stats/migrations.js';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import { summaryStats, taskTimeline, analysisStats } from '../../src/stats/dashboard-queries.js';
import { buildDashboardFixture, tmpDbPath, flush } from './dashboard-fixture.js';

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be close to ${expected}`);
}

// --- Summary view ---

test('summaryStats reports every figure computed by hand from the fixture', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const stats = summaryStats(db)!;
  db.close();

  assert.equal(stats.taskCount, fixture.expected.taskCount);
  assert.equal(stats.inputTokens, fixture.expected.inputTokens);
  assert.equal(stats.outputTokens, fixture.expected.outputTokens);
  assert.equal(stats.cachedTokens, fixture.expected.cachedTokens);
  closeTo(stats.cacheHitRate!, fixture.expected.cacheHitRate);
  closeTo(stats.estimatedCost, fixture.expected.estimatedCost);
  assert.equal(stats.costPartial, true);
  closeTo(stats.avgTokensPerTask, fixture.expected.avgTokensPerTask);
  closeTo(stats.avgTurnsPerTask, fixture.expected.avgTurnsPerTask);
  closeTo(stats.avgToolCallsPerTask, fixture.expected.avgToolCallsPerTask);

  const search = stats.toolShares.find((t) => t.toolName === 'search')!;
  const write = stats.toolShares.find((t) => t.toolName === 'write')!;
  closeTo(search.share, fixture.expected.toolShares.search);
  closeTo(write.share, fixture.expected.toolShares.write);
  assert.equal(stats.toolShares[0].toolName, 'search', 'ranked with the largest share first');
});

test('summaryStats reports no data over an empty database', () => {
  const db = new DatabaseSync(tmpDbPath());
  migrate(db);
  try {
    assert.equal(summaryStats(db), null);
  } finally {
    db.close();
  }
});

// --- Timeline view ---

test('taskTimeline lists turns in order, each with its tool calls and their result sizes', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const timeline = taskTimeline(db, fixture.task1Id)!;
  db.close();

  assert.equal(timeline.turns.length, 2);
  assert.deepEqual(
    timeline.turns.map((t) => t.turnNumber),
    [0, 1]
  );

  assert.equal(timeline.turns[0].inputTokens, 100);
  assert.equal(timeline.turns[0].outputTokens, 50);
  assert.equal(timeline.turns[0].toolCalls.length, 1);
  assert.equal(timeline.turns[0].toolCalls[0].toolName, 'search');
  assert.equal(timeline.turns[0].toolCalls[0].resultSize, 40);

  assert.equal(timeline.turns[1].inputTokens, 200);
  assert.equal(timeline.turns[1].outputTokens, 80);
  assert.equal(timeline.turns[1].toolCalls.length, 2);
  assert.equal(timeline.turns[1].toolCalls[0].toolName, 'search');
  assert.equal(timeline.turns[1].toolCalls[0].resultSize, 80);
  assert.equal(timeline.turns[1].toolCalls[1].toolName, 'write');
  assert.equal(timeline.turns[1].toolCalls[1].resultSize, 20);
});

test('taskTimeline reports not found for an unknown task identifier', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const timeline = taskTimeline(db, fixture.task1Id + fixture.task2Id + 1000);
  db.close();

  assert.equal(timeline, null);
});

// --- Analysis view ---

test('analysisStats ranks tools and names the most expensive turn', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const analysis = analysisStats(db)!;
  db.close();

  assert.equal(analysis.toolShares[0].toolName, 'search');
  closeTo(analysis.toolShares[0].share, fixture.expected.toolShares.search);

  assert.equal(analysis.mostExpensiveTurn!.taskId, fixture.task1Id);
  assert.equal(analysis.mostExpensiveTurn!.turnNumber, fixture.expected.mostExpensiveTurn.turnNumber);
  assert.equal(analysis.mostExpensiveTurn!.model, fixture.expected.mostExpensiveTurn.model);
  assert.equal(analysis.mostExpensiveTurn!.inputTokens, fixture.expected.mostExpensiveTurn.inputTokens);
});

test('analysisStats category shares account for the reported input tokens, with no unattributed remainder', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const analysis = analysisStats(db)!;
  db.close();

  const { categoryShares } = analysis;
  assert.equal(categoryShares.instructionTokens, fixture.expected.categoryTotals.instructionTokens);
  assert.equal(categoryShares.userRequestTokens, fixture.expected.categoryTotals.userRequestTokens);
  assert.equal(categoryShares.conversationTokens, fixture.expected.categoryTotals.conversationTokens);
  assert.equal(categoryShares.toolOutputTokens, fixture.expected.categoryTotals.toolOutputTokens);
  assert.equal(categoryShares.toolDefinitionTokens, fixture.expected.categoryTotals.toolDefinitionTokens);
  assert.equal(
    categoryShares.instructionTokens +
      categoryShares.userRequestTokens +
      categoryShares.conversationTokens +
      categoryShares.toolOutputTokens +
      categoryShares.toolDefinitionTokens,
    categoryShares.totalTokens
  );
  assert.equal(categoryShares.totalTokens, fixture.expected.inputTokens, 'accounts for every reported input token, no remainder');
  assert.equal(categoryShares.excludedRows, 0);

  assert.equal(analysis.repeatedVsNew.repeatedTokens, fixture.expected.repeatedVsNew.repeatedTokens);
  assert.equal(analysis.repeatedVsNew.newTokens, fixture.expected.repeatedVsNew.newTokens);
});

test('analysisStats reports the tool-definition category as its own line, distinct from instructions', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const analysis = analysisStats(db)!;
  db.close();

  assert.ok(analysis.categoryShares.toolDefinitionTokens > 0, 'the tool-definition category must carry a non-zero share');
  assert.notEqual(
    analysis.categoryShares.toolDefinitionTokens,
    analysis.categoryShares.instructionTokens,
    'the tool-definition figure must be distinguishable from the instruction figure, not merged into it'
  );
});

// --- Honest reporting of missing data ---

test('cache hit rate is unavailable rather than zero when no call reported cache statistics', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x', usage: { promptTokens: 10, completionTokens: 5 } });
  await flush();
  recorder.recordMessage({ chatId: 1, reply: 'r', replySentAt: 10, ok: true, iterations: 1 });
  await flush();

  const db = new DatabaseSync(dbPath);
  const stats = summaryStats(db)!;
  db.close();

  assert.equal(stats.cacheHitRate, null);
});

test('cost total is marked partial when activity included an unpriced model', async () => {
  const fixture = await buildDashboardFixture();
  const db = new DatabaseSync(fixture.dbPath);
  const stats = summaryStats(db)!;
  db.close();

  assert.equal(stats.costPartial, true);
});

test('an aggregate spanning rows from both attributions excludes the rows recorded under the previous attribution rather than combining the two into one figure', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();

  // A row as the previous (tool-definition-blind) attribution would have written it: the
  // category and repeated-input columns are populated (this is not the "field never existed"
  // case already covered below), but `attribution_version` is left at its migration default
  // (0) because no code path sets it to 1 except the current recorder.
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `INSERT INTO llm_calls (
       message_id, turn_number, role, agent_id, model, input_tokens, output_tokens, latency, ok, timestamp,
       instruction_tokens, user_request_tokens, conversation_tokens, tool_output_tokens,
       repeated_input_tokens, new_input_tokens, tool_definition_tokens, attribution_version
     )
     VALUES (1, 0, 'main', 'main', 'stub', 500, 10, 0, 1, '2024-01-01T00:00:00.000Z', 400, 50, 50, 0, 0, 500, 0, 0)`
  ).run();
  db.close();

  recorder.recordLlmCall({
    iteration: 1,
    model: 'stub',
    ok: true,
    text: 'y',
    usage: { promptTokens: 40, completionTokens: 10 },
    calledAt: 1000,
    categoryTokens: { instructionTokens: 5, userRequestTokens: 5, conversationTokens: 10, toolOutputTokens: 5, toolDefinitionTokens: 15 },
    repeatedInput: { repeatedTokens: 15, newTokens: 25 },
  });
  await flush();
  recorder.recordMessage({ chatId: 1, reply: 'r', replySentAt: 10, ok: true, iterations: 2 });
  await flush();

  const readDb = new DatabaseSync(dbPath);
  const analysis = analysisStats(readDb)!;
  readDb.close();

  assert.equal(analysis.categoryShares.excludedRows, 1);
  assert.equal(analysis.categoryShares.totalTokens, 40, 'the pre-fix row\'s 500 input tokens must not be averaged into the total');
  assert.equal(analysis.categoryShares.toolDefinitionTokens, 15);
  assert.equal(analysis.repeatedVsNew.excludedRows, 1);
  assert.equal(analysis.repeatedVsNew.repeatedTokens, 15);
  assert.equal(analysis.repeatedVsNew.newTokens, 25);
});

test('rows recorded before category and repeated-input tracking existed are excluded from those aggregates, not averaged in as zero', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  // No `calledAt`, `categoryTokens`, or `repeatedInput`: simulates a row from before those
  // fields existed - timestamp and every migration-added field land on their default.
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x', usage: { promptTokens: 100, completionTokens: 10 } });
  await flush();
  recorder.recordLlmCall({
    iteration: 1,
    model: 'stub',
    ok: true,
    text: 'y',
    usage: { promptTokens: 40, completionTokens: 10 },
    calledAt: 1000,
    categoryTokens: { instructionTokens: 10, userRequestTokens: 10, conversationTokens: 10, toolOutputTokens: 10, toolDefinitionTokens: 0 },
    repeatedInput: { repeatedTokens: 15, newTokens: 25 },
  });
  await flush();
  recorder.recordMessage({ chatId: 1, reply: 'r', replySentAt: 10, ok: true, iterations: 2 });
  await flush();

  const db = new DatabaseSync(dbPath);
  const analysis = analysisStats(db)!;
  db.close();

  assert.equal(analysis.categoryShares.excludedRows, 1);
  assert.equal(analysis.categoryShares.totalTokens, 40);
  assert.equal(analysis.repeatedVsNew.excludedRows, 1);
  assert.equal(analysis.repeatedVsNew.repeatedTokens, 15);
  assert.equal(analysis.repeatedVsNew.newTokens, 25);
});
