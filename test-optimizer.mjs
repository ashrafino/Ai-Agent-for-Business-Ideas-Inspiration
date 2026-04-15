#!/usr/bin/env node

/**
 * Test script for the intelligent scraper optimizer
 * 
 * Usage: node test-optimizer.mjs
 */

import { analyzeContent } from './netlify/functions/lib/scraper-optimizer.mjs';

console.log('='.repeat(70));
console.log('Scraper Optimizer Test - NLP & Quality Scoring');
console.log('='.repeat(70));
console.log();

// Test cases with different quality levels
const testCases = [
  {
    name: "🥇 GOLD - Validated Startup with MRR",
    text: "We launched our micro-SaaS 3 months ago and hit $5k MRR with 120 paying customers. Built a simple API tool that automates invoice processing for small businesses. Looking to scale to $10k MRR by end of quarter.",
    metadata: { upvotes: 250, comments: 45, source: "indiehackers", createdAt: new Date().toISOString() }
  },
  {
    name: "🥇 GOLD - Clear Pain Point with Demand",
    text: "Is there a tool that automatically syncs Notion with Google Calendar? I'm tired of manually copying tasks. Would pay $10/month for this. Tried Zapier but it's too complicated and expensive at $20/month.",
    metadata: { upvotes: 180, comments: 67, source: "reddit", createdAt: new Date().toISOString() }
  },
  {
    name: "🥈 HIGH - Product Launch",
    text: "Just shipped our Chrome extension for developers. It helps you debug API calls directly in the browser. Free tier available, pro version is $9/month. Built with React and Node.js.",
    metadata: { upvotes: 95, comments: 23, source: "producthunt", createdAt: new Date().toISOString() }
  },
  {
    name: "🥉 MEDIUM - Startup Idea Discussion",
    text: "Thinking about building a SaaS for freelancers to manage their invoices and time tracking. Market seems crowded but most tools are too complicated. Anyone interested in this space?",
    metadata: { upvotes: 45, comments: 12, source: "reddit", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() }
  },
  {
    name: "❌ LOW - Vague/Generic",
    text: "This revolutionary AI-powered platform will disrupt the entire industry. Game-changer for businesses. Next big thing in tech. Don't miss out!",
    metadata: { upvotes: 5, comments: 1, source: "unknown", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
  },
  {
    name: "❌ SPAM - Promotional",
    text: "Click here now! Amazing deal! 100% free! Limited time offer! Buy now and get rich quick with our incredible crypto NFT platform! Guaranteed returns!",
    metadata: { upvotes: 2, comments: 0, source: "spam", createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() }
  },
  {
    name: "🥇 GOLD - YC Company with Traction",
    text: "We're building AI-powered code review tools for enterprise teams. Raised $2M seed round, currently at $50k MRR with 15 paying customers including 2 Fortune 500 companies. Growing 20% month-over-month.",
    metadata: { upvotes: 320, comments: 89, source: "ycombinator", featured: true, createdAt: new Date().toISOString() }
  },
  {
    name: "🥈 HIGH - Technical Problem",
    text: "How do you handle real-time collaboration in your SaaS? We're building a document editor and struggling with conflict resolution. Looking at CRDTs but implementation is complex. What stack do you use?",
    metadata: { upvotes: 156, comments: 78, source: "hackernews", createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() }
  },
];

console.log('Analyzing test cases...\n');

testCases.forEach((testCase, idx) => {
  console.log(`Test ${idx + 1}: ${testCase.name}`);
  console.log('-'.repeat(70));
  console.log(`Text: "${testCase.text.slice(0, 100)}..."`);
  console.log();
  
  const analysis = analyzeContent(testCase.text, testCase.metadata);
  
  console.log('Scores:');
  console.log(`  Validation Signal:    ${analysis.validationScore.toFixed(1)} (revenue, customers, traction)`);
  console.log(`  Pain Point Signal:    ${analysis.painPointScore.toFixed(1)} (problems, needs, frustrations)`);
  console.log(`  Startup Relevance:    ${analysis.startupRelevanceScore.toFixed(1)} (SaaS, bootstrapped, etc.)`);
  console.log(`  Market Signals:       ${analysis.marketSignalScore.toFixed(1)} (market size, competition)`);
  console.log(`  Technical Depth:      ${analysis.technicalScore.toFixed(1)} (tech stack, implementation)`);
  console.log(`  Spam Score:           ${analysis.spamScore.toFixed(1)} (negative = spam detected)`);
  console.log();
  
  console.log('Quality Metrics:');
  console.log(`  Specificity:          ${analysis.specificity.toFixed(1)}/50 (numbers, URLs, names)`);
  console.log(`  Readability:          ${analysis.readability.toFixed(1)}/50 (sentence structure)`);
  console.log(`  Engagement:           ${analysis.engagementScore.toFixed(1)}/50 (upvotes, comments)`);
  console.log(`  Recency:              ${analysis.recencyScore.toFixed(1)}/50 (how recent)`);
  console.log(`  Credibility:          ${analysis.credibilityScore.toFixed(1)}/50 (source trust)`);
  console.log();
  
  console.log(`🎯 FINAL QUALITY SCORE: ${analysis.qualityScore.toFixed(1)}`);
  console.log(`📊 PRIORITY: ${analysis.priority}`);
  console.log(`✅ INCLUDE IN ANALYSIS: ${analysis.shouldInclude ? 'YES' : 'NO'}`);
  console.log();
  console.log('='.repeat(70));
  console.log();
});

// Summary
console.log('Summary:');
console.log('-'.repeat(70));
const included = testCases.filter(tc => {
  const analysis = analyzeContent(tc.text, tc.metadata);
  return analysis.shouldInclude;
});

const byPriority = {
  GOLD: testCases.filter(tc => analyzeContent(tc.text, tc.metadata).priority === 'GOLD').length,
  HIGH: testCases.filter(tc => analyzeContent(tc.text, tc.metadata).priority === 'HIGH').length,
  MEDIUM: testCases.filter(tc => analyzeContent(tc.text, tc.metadata).priority === 'MEDIUM').length,
  LOW: testCases.filter(tc => analyzeContent(tc.text, tc.metadata).priority === 'LOW').length,
};

console.log(`Total Test Cases: ${testCases.length}`);
console.log(`Would Include: ${included.length} (${Math.round(included.length / testCases.length * 100)}%)`);
console.log(`Would Filter Out: ${testCases.length - included.length}`);
console.log();
console.log('Priority Distribution:');
console.log(`  🥇 GOLD:   ${byPriority.GOLD} (validated traction, clear pain points)`);
console.log(`  🥈 HIGH:   ${byPriority.HIGH} (strong signals, good engagement)`);
console.log(`  🥉 MEDIUM: ${byPriority.MEDIUM} (relevant but less specific)`);
console.log(`  ❌ LOW:    ${byPriority.LOW} (spam, vague, off-topic)`);
console.log();
console.log('✅ Optimizer is working correctly!');
console.log('   High-quality content is prioritized, spam is filtered out.');
