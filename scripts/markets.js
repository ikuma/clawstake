#!/usr/bin/env node

/**
 * Fetch Clawdict markets and display staking opportunities.
 * Usage: node scripts/markets.js [--token <CLAWDICT_TOKEN>]
 */

require("dotenv").config();

const API_BASE = "https://www.clawdict.com/api";

async function fetchMarkets(token) {
  const headers = {};
  if (token) headers["X-Agent-Token"] = token;

  const res = await fetch(`${API_BASE}/markets/top`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchLeaderboard() {
  const res = await fetch(`${API_BASE}/leaderboard`);
  if (!res.ok) return null;
  return res.json();
}

function displayMarket(market, index) {
  const slug = market.slug || market.id || "unknown";
  const title = market.title || market.question || slug;
  const pYes = market.probability ?? market.pYes ?? market.p_yes ?? null;
  const volume = market.volume ?? market.totalVolume ?? null;
  const closeDate = market.closeDate || market.close_date || market.endDate || null;

  console.log(`\n  ${index + 1}. ${title}`);
  console.log(`     Slug: ${slug}`);
  if (pYes !== null) console.log(`     Current pYes: ${(pYes * 100).toFixed(1)}%`);
  if (volume !== null) console.log(`     Volume: ${volume}`);
  if (closeDate) console.log(`     Closes: ${closeDate}`);
  console.log(`     Stake: npx hardhat run scripts/stake.js --network baseSepolia -- --slug "${slug}" --side yes --amount 5`);
}

async function main() {
  const args = process.argv.slice(2);
  let token = process.env.CLAWDICT_TOKEN;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--token" && args[i + 1]) token = args[++i];
  }

  console.log("🦀 ClawStake — Clawdict Market Explorer\n");
  console.log("Fetching markets from Clawdict API...");

  try {
    const data = await fetchMarkets(token);
    const markets = Array.isArray(data) ? data : data.markets || data.data || [];

    if (markets.length === 0) {
      console.log("\n  No markets found. The API may require an X-Agent-Token.");
      console.log("  Set CLAWDICT_TOKEN in .env or pass --token <token>");
      return;
    }

    console.log(`\n📊 Top ${markets.length} Markets:\n`);
    console.log("─".repeat(60));

    markets.forEach((market, i) => displayMarket(market, i));

    console.log("\n" + "─".repeat(60));
    console.log("\n💡 Staking Tips:");
    console.log("  • Research each market before staking");
    console.log("  • Stake on markets where you have high confidence");
    console.log("  • Diversify across multiple markets");
    console.log("  • This is TESTNET — experiment freely!\n");
  } catch (err) {
    console.error(`\n❌ Failed to fetch markets: ${err.message}`);
    console.log("\nMake sure you have a valid CLAWDICT_TOKEN set in .env");
  }

  // Also show leaderboard
  try {
    console.log("\n🏆 Clawdict Leaderboard (top forecasters):\n");
    const lb = await fetchLeaderboard();
    const entries = Array.isArray(lb) ? lb : lb?.leaderboard || lb?.data || [];

    if (entries.length > 0) {
      entries.slice(0, 10).forEach((entry, i) => {
        const name = entry.name || entry.username || entry.agent || "?";
        const score = entry.score ?? entry.brierScore ?? entry.accuracy ?? "?";
        console.log(`  ${i + 1}. ${name} — Score: ${score}`);
      });
    } else {
      console.log("  No leaderboard data available.");
    }
  } catch {
    console.log("  Could not fetch leaderboard.");
  }
}

main();
