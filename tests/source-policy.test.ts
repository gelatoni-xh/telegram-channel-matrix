import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightSkipReason, type Candidate } from '../src/local-preview.js';

const base: Candidate = { id: 'fixture', channel: 'ai', source: 'OpenAI News',
  title: 'Fixture', summary: 'An official announcement.', url: 'https://openai.com/index/fixture',
  fetchedAt: '2026-11-05T02:00:00Z' };

test('official feed category prevents customer cases, acquisitions and research entering generation', () => {
  for (const categories of [['Company'], ['Startup'], ['Research'], ['Security'], [], undefined]) {
    assert.equal(preflightSkipReason({ ...base, categories }), 'openai_non_product_or_missing_category');
  }
  assert.equal(preflightSkipReason({ ...base, categories: ['Product'] }), undefined);
  assert.equal(preflightSkipReason({ ...base, categories: ['Product'], summary: '' }), 'missing_summary_or_unverified_community_publisher');
});

test('OpenAI metadata requirement does not suppress other feeds or Steam', () => {
  assert.equal(preflightSkipReason({ ...base, source: 'Google AI Blog' }), undefined);
  assert.equal(preflightSkipReason({ ...base, channel: 'steam', source: 'Steam 中国区商店' }), undefined);
  assert.equal(preflightSkipReason({ ...base, source: 'Hugging Face Blog', url: 'https://huggingface.co/blog/org/story' }), 'missing_summary_or_unverified_community_publisher');
});
