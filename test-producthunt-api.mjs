#!/usr/bin/env node

/**
 * Local test script for ProductHunt API integration
 * 
 * Usage:
 *   1. Create a .env file with your ProductHunt credentials:
 *      PRODUCTHUNT_CLIENT_ID=your_client_id
 *      PRODUCTHUNT_CLIENT_SECRET=your_client_secret
 * 
 *   2. Run: node test-producthunt-api.mjs
 */

import { readFileSync } from 'fs';
import { scrapeAllSources } from './netlify/functions/lib/scraper.mjs';

// Load environment variables from .env file
function loadEnv() {
  try {
    const envFile = readFileSync('.env', 'utf-8');
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        if (key && value) {
          process.env[key.trim()] = value;
        }
      }
    });
    console.log('✓ Loaded environment variables from .env file\n');
  } catch (err) {
    console.warn('⚠ No .env file found. Using existing environment variables.\n');
  }
}

async function testProductHuntAPI() {
  console.log('='.repeat(60));
  console.log('ProductHunt API Integration Test');
  console.log('='.repeat(60));
  console.log();

  // Check credentials
  const hasClientId = !!process.env.PRODUCTHUNT_CLIENT_ID;
  const hasClientSecret = !!process.env.PRODUCTHUNT_CLIENT_SECRET;

  console.log('Credentials Check:');
  console.log(`  PRODUCTHUNT_CLIENT_ID: ${hasClientId ? '✓ Set' : '✗ Missing'}`);
  console.log(`  PRODUCTHUNT_CLIENT_SECRET: ${hasClientSecret ? '✓ Set' : '✗ Missing'}`);
  console.log();

  if (!hasClientId || !hasClientSecret) {
    console.error('❌ ProductHunt API credentials are missing!');
    console.log('\nTo get your credentials:');
    console.log('  1. Go to https://www.producthunt.com/v2/oauth/applications');
    console.log('  2. Create a new application');
    console.log('  3. Copy the Client ID and Client Secret');
    console.log('  4. Create a .env file with:');
    console.log('     PRODUCTHUNT_CLIENT_ID=your_client_id');
    console.log('     PRODUCTHUNT_CLIENT_SECRET=your_client_secret');
    console.log();
    process.exit(1);
  }

  console.log('Starting scrape...\n');
  const startTime = Date.now();

  try {
    const results = await scrapeAllSources();
    const duration = Date.now() - startTime;

    console.log('='.repeat(60));
    console.log('Scrape Results');
    console.log('='.repeat(60));
    console.log();
    console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`Scraped at: ${results.scrapedAt}`);
    console.log();

    // Display ProductHunt results
    const phPosts = results.productHunt?.posts || [];
    const phSource = results.productHunt?.source || 'Unknown';
    
    console.log(`ProductHunt Source: ${phSource}`);
    console.log(`ProductHunt Posts: ${phPosts.length}`);
    console.log();

    if (phPosts.length > 0) {
      console.log('Top ProductHunt Posts:');
      console.log('-'.repeat(60));
      
      phPosts.slice(0, 10).forEach((post, idx) => {
        console.log(`\n${idx + 1}. ${post.title}`);
        if (post.tagline) console.log(`   Tagline: ${post.tagline}`);
        console.log(`   Upvotes: ${post.upvotes || 0} | Comments: ${post.comments || 0}`);
        if (post.topics && post.topics.length > 0) {
          console.log(`   Topics: ${post.topics.join(', ')}`);
        }
        if (post.makers && post.makers.length > 0) {
          console.log(`   Makers: ${post.makers.join(', ')}`);
        }
        console.log(`   URL: ${post.url}`);
      });
      
      console.log();
      console.log('='.repeat(60));
      console.log(`✓ Successfully fetched ${phPosts.length} ProductHunt posts`);
      
      if (phSource.includes('API')) {
        console.log('✓ Using ProductHunt API (rich data)');
      } else {
        console.log('⚠ Using ProductHunt RSS fallback (limited data)');
      }
    } else {
      console.log('⚠ No ProductHunt posts found');
    }

    // Summary of all sources
    console.log();
    console.log('All Sources Summary:');
    console.log('-'.repeat(60));
    console.log(`  Hacker News: ${results.hackerNews?.posts?.length || 0}`);
    console.log(`  Hacker News Ask: ${results.hackerNewsAsk?.posts?.length || 0}`);
    console.log(`  Reddit: ${results.reddit?.posts?.length || 0}`);
    console.log(`  Product Hunt: ${phPosts.length}`);
    console.log(`  Indie Hackers: ${results.indieHackers?.posts?.length || 0}`);
    console.log(`  GitHub Trending: ${results.githubTrending?.repos?.length || 0}`);
    console.log(`  Y Combinator: ${results.ycombinator?.companies?.length || 0}`);
    console.log(`  DEV.to: ${results.devTo?.posts?.length || 0}`);
    console.log(`  BetaList: ${results.betaList?.posts?.length || 0}`);
    console.log(`  Lobsters: ${results.lobsters?.posts?.length || 0}`);
    console.log(`  AppSumo: ${results.appSumo?.posts?.length || 0}`);
    console.log(`  Starter Story: ${results.starterStory?.posts?.length || 0}`);
    console.log();

  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error('\nError details:', err);
    process.exit(1);
  }
}

// Run the test
loadEnv();
testProductHuntAPI();
