#!/usr/bin/env node

import { readFileSync } from 'fs';

// Load environment variables
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
} catch (err) {
  console.error('No .env file found');
  process.exit(1);
}

async function testProductHunt() {
  console.log('Testing ProductHunt API...\n');
  
  const clientId = process.env.PRODUCTHUNT_CLIENT_ID;
  const clientSecret = process.env.PRODUCTHUNT_CLIENT_SECRET;
  
  console.log(`Client ID: ${clientId?.slice(0, 10)}...`);
  console.log(`Client Secret: ${clientSecret?.slice(0, 10)}...\n`);
  
  // Get token
  console.log('Step 1: Getting OAuth token...');
  const tokenRes = await fetch("https://api.producthunt.com/v2/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  
  const tokenData = await tokenRes.json();
  console.log('Token response:', JSON.stringify(tokenData, null, 2));
  
  if (!tokenData.access_token) {
    console.error('\n❌ Failed to get access token');
    return;
  }
  
  console.log('\n✓ Got access token\n');
  
  // Test GraphQL query
  console.log('Step 2: Testing GraphQL query...');
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const query = `
    query {
      posts(order: VOTES, postedAfter: "${fourteenDaysAgo}", first: 10) {
        edges {
          node {
            id
            name
            tagline
            votesCount
            commentsCount
            url
            website
            topics {
              edges {
                node {
                  name
                }
              }
            }
          }
        }
      }
    }
  `;
  
  const graphqlRes = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  
  const graphqlData = await graphqlRes.json();
  console.log('GraphQL response:', JSON.stringify(graphqlData, null, 2));
  
  if (graphqlData.errors) {
    console.error('\n❌ GraphQL errors:', graphqlData.errors);
    return;
  }
  
  const posts = graphqlData?.data?.posts?.edges || [];
  console.log(`\n✓ Got ${posts.length} posts`);
  
  posts.slice(0, 3).forEach((edge, idx) => {
    const post = edge.node;
    console.log(`\n${idx + 1}. ${post.name}`);
    console.log(`   Tagline: ${post.tagline}`);
    console.log(`   Upvotes: ${post.votesCount}`);
    console.log(`   URL: ${post.website || post.url}`);
  });
}

testProductHunt().catch(console.error);
