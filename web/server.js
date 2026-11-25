
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initProgressionDatabase, awardXp, recordActivity, recordDailyVisit, claimMission, claimAchievement, getCoreOverview } = require('./progression');
const { initMiniGamesDatabase, startMiniGame, performMiniGameAction } = require('./minigames');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = 'Gitfmoneybot';

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID) {
  throw new Error('Проверь BOT_TOKEN, DATABASE_URL и ADMIN_ID');
}

const pool = new Pool({ connectionString: DATABASE_URL });

const toStars = (gram) => Math.ceil(gram * 62.6 / 10) * 10;

const giftImage = (slug) =>
  `https://fragment.com/file/gifts/${slug}/thumb.webp`;

function getLevelStats(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const n = Math.floor((-3 + Math.sqrt(9 + (4 * xp) / 25)) / 2);
  const level = n + 1;
  const xpAtLevel = 25 * n * (n + 3);
  const needed = 100 + 50 * n;
  const progress = xp - xpAtLevel;
  return { level, xp_progress: progress, xp_required: needed, xp_to_next: needed - progress };
}

const PROFILE_RANKS = [
  { min: 0, key: 'rookie', name: 'Новичок', wings: 'Без крыльев' },
  { min: 50, key: 'copper', name: 'Медные крылья', wings: 'Медь' },
  { min: 500, key: 'metal', name: 'Металлические крылья', wings: 'Металл' },
  { min: 1000, key: 'gold', name: 'Золотые крылья', wings: 'Золото' },
  { min: 2000, key: 'silver', name: 'Серебряные крылья', wings: 'Серебро' },
  { min: 3000, key: 'green-diamond', name: 'Зелёный алмаз', wings: 'Зелёный алмаз' },
  { min: 4000, key: 'blue-diamond', name: 'Голубой алмаз', wings: 'Голубой алмаз' },
  { min: 5000, key: 'legend', name: 'ЛЕГЕНДА', wings: 'Красный алмаз' }
];

function getProfileRank(openings) {
  const count = Math.max(0, Number(openings) || 0);
  let index = 0;
  for (let i = 1; i < PROFILE_RANKS.length; i++) if (count >= PROFILE_RANKS[i].min) index = i;
  const current = PROFILE_RANKS[index], next = PROFILE_RANKS[index + 1] || null;
  return {
    ...current, openings: count,
    next_rank: next ? next.name : null,
    rank_progress: next ? Math.min(100, Math.max(0, ((count-current.min)/(next.min-current.min))*100)) : 100,
    openings_to_next: next ? Math.max(0,next.min-count) : 0
  };
}

const PRODUCTS = [
  { id: 'toy_bear', name: 'Toy Bear', stars: toStars(43), discount: 10, emoji: '🧸', image_url: giftImage('toybear') },
  { id: 'diamond_ring', name: 'Diamond Ring', stars: toStars(43), discount: 10, emoji: '💍', image_url: giftImage('diamondring') },
  { id: 'genie_lamp', name: 'Genie Lamp', stars: toStars(44), discount: 10, emoji: '🪔', image_url: giftImage('genielamp') },
  { id: 'voodoo_doll', name: 'Voodoo Doll', stars: toStars(49), discount: 10, emoji: '🧸', image_url: giftImage('voodoodoll') },
  { id: 'bonded_ring', name: 'Bonded Ring', stars: toStars(55), discount: 10, emoji: '💍', image_url: giftImage('bondedring') },
  { id: 'sharp_tongue', name: 'Sharp Tongue', stars: toStars(58), discount: 10, emoji: '👅', image_url: giftImage('sharptongue') },
  { id: 'kissed_frog', name: 'Kissed Frog', stars: toStars(68), discount: 10, emoji: '🐸', image_url: giftImage('kissedfrog') },
  { id: 'magic_potion', name: 'Magic Potion', stars: toStars(75), discount: 10, emoji: '🧪', image_url: giftImage('magicpotion') },
  { id: 'crystal_ball', name: 'Crystal Ball', stars: toStars(17), discount: 5, emoji: '🔮', image_url: giftImage('crystalball') },
  { id: 'flying_broom', name: 'Flying Broom', stars: toStars(16), discount: 5, emoji: '🧹', image_url: giftImage('flyingbroom') },
  { id: 'record_player', name: 'Record Player', stars: toStars(15), discount: 5, emoji: '🎵', image_url: giftImage('recordplayer') },
  { id: 'sakura_flower', name: 'Sakura Flower', stars: toStars(14), discount: 5, emoji: '🌸', image_url: giftImage('sakuraflower') },
  { id: 'top_hat', name: 'Top Hat', stars: toStars(13), discount: 5, emoji: '🎩', image_url: giftImage('tophat') },
  { id: 'jingle_bell', name: 'Jingle Bell', stars: toStars(12), discount: 5, emoji: '🔔', image_url: giftImage('jinglebells') },
  { id: 'snow_globe', name: 'Snow Globe', stars: toStars(9), discount: 5, emoji: '❄️', image_url: giftImage('snowglobe') },
{ id: 'neko_helmet', name: 'Neko Helmet', stars: toStars(49), discount: 10, emoji: '🐱', image_url: giftImage('nekohelmet') },
{ id: 'mighty_arms', name: 'Mighty Arms', stars: toStars(150), discount: 10, emoji: '💪', image_url: giftImage('mightyarms') },
{ id: 'nail_bracelets', name: 'Nail Bracelets', stars: toStars(150), discount: 10, emoji: '💅', image_url: giftImage('nailbracelets') },
{ id: 'westside_signs', name: 'Westside Signs', stars: toStars(149), discount: 10, emoji: '🪧', image_url: giftImage('westsidesigns') },
{ id: 'mini_oscars', name: 'Mini Oscars', stars: toStars(120), discount: 10, emoji: '🏆', image_url: giftImage('minioscars') },
{ id: 'low_riders', name: 'Low Riders', stars: toStars(90), discount: 10, emoji: '🚗', image_url: giftImage('lowriders') },
{ id: 'ion_gems', name: 'Ion Gems', stars: toStars(88), discount: 10, emoji: '💎', image_url: giftImage('iongems') },
{ id: 'artisan_bricks', name: 'Artisan Bricks', stars: toStars(85), discount: 10, emoji: '🧱', image_url: giftImage('artisanbricks') },
{ id: 'gem_signets', name: 'Gem Signets', stars: toStars(75), discount: 10, emoji: '💍', image_url: giftImage('gemsignets') },
{ id: 'astral_shards', name: 'Astral Shards', stars: toStars(180), discount: 10, emoji: '✨', image_url: giftImage('astralshards') },
{ id: 'durovs_glasses', name: "Durov's Glasses", stars: toStars(170), discount: 10, emoji: '🕶️', image_url: giftImage('durovsglasses') },
{ id: 'loot_bags', name: 'Loot Bags', stars: toStars(160), discount: 10, emoji: '💰', image_url: giftImage('lootbags') },
{ id: 'lucky_lockets', name: 'Lucky Lockets', stars: toStars(20), discount: 5, emoji: '🍀', image_url: giftImage('luckylockets') },
{ id: 'electric_skulls', name: 'Electric Skulls', stars: toStars(40), discount: 5, emoji: '💀', image_url: giftImage('electricskulls') },
{ id: 'khabibs_papakhas', name: "Khabib's Papakhas", stars: toStars(39), discount: 5, emoji: '🧢', image_url: giftImage('khabibspapakhas') },
{ id: 'rare_birds', name: 'Rare Birds', stars: toStars(35), discount: 5, emoji: '🐦', image_url: giftImage('rarebirds') },
{ id: 'bling_binkies', name: 'Bling Binkies', stars: toStars(30), discount: 5, emoji: '💎', image_url: giftImage('blingbinkies') },
{ id: 'cupid_charms', name: 'Cupid Charms', stars: toStars(27), discount: 5, emoji: '💘', image_url: giftImage('cupidcharms') },
{ id: 'sky_stilettos', name: 'Sky Stilettos', stars: toStars(26), discount: 5, emoji: '👠', image_url: giftImage('skystilettos') },
{ id: 'ufc_strikes', name: 'UFC Strikes', stars: toStars(23), discount: 5, emoji: '🥊', image_url: giftImage('ufcstrikes') },
{ id: 'ionic_dryers', name: 'Ionic Dryers', stars: toStars(20), discount: 5, emoji: '💨', image_url: giftImage('ionicdryers') },
{ id: 'snoop_cigars', name: 'Snoop Cigars', stars: toStars(20), discount: 5, emoji: '🚬', image_url: giftImage('snoopcigars') },
{ id: 'love_potions', name: 'Love Potions', stars: toStars(20), discount: 5, emoji: '💗', image_url: giftImage('lovepotions') },
{ id: 'mad_pumpkins', name: 'Mad Pumpkins', stars: toStars(15), discount: 5, emoji: '🎃', image_url: giftImage('madpumpkins') },
{ id: 'valentine_boxes', name: 'Valentine Boxes', stars: toStars(15), discount: 5, emoji: '💝', image_url: giftImage('valentineboxes') },
{ id: 'love_candles', name: 'Love Candles', stars: toStars(14), discount: 5, emoji: '🕯️', image_url: giftImage('lovecandles') },
{ id: 'myth_masks', name: 'Myth Masks', stars: toStars(12), discount: 5, emoji: '🎭', image_url: giftImage('mythmasks') },
{ id: 'bunny_muffins', name: 'Bunny Muffins', stars: toStars(11), discount: 5, emoji: '🧁', image_url: giftImage('bunnymuffins') },
{ id: 'hanging_stars', name: 'Hanging Stars', stars: toStars(11), discount: 5, emoji: '⭐', image_url: giftImage('hangingstars') },
{ id: 'jolly_chimps', name: 'Jolly Chimps', stars: toStars(11), discount: 5, emoji: '🐵', image_url: giftImage('jollychimps') },
{ id: 'joyful_bundles', name: 'Joyful Bundles', stars: toStars(11), discount: 5, emoji: '🎁', image_url: giftImage('joyfulbundles') },
{ id: 'fine_pens', name: 'Fine Pens', stars: toStars(10), discount: 5, emoji: '🖊️', image_url: giftImage('finepens') },
{ id: 'snow_mittens', name: 'Snow Mittens', stars: toStars(10), discount: 5, emoji: '🧤', image_url: giftImage('snowmittens') },
{ id: 'faith_amulets', name: 'Faith Amulets', stars: toStars(9), discount: 5, emoji: '📿', image_url: giftImage('faithamulets') },
{ id: 'surge_boards', name: 'Surge Boards', stars: toStars(9), discount: 5, emoji: '🛹', image_url: giftImage('surgeboards') },
{ id: 'eternal_candles', name: 'Eternal Candles', stars: toStars(8), discount: 5, emoji: '🕯️', image_url: giftImage('eternalcandles') },
{ id: 'input_keys', name: 'Input Keys', stars: toStars(8), discount: 5, emoji: '⌨️', image_url: giftImage('inputkeys') },
{ id: 'liberty_figures', name: 'Liberty Figures', stars: toStars(8), discount: 5, emoji: '🗽', image_url: giftImage('libertyfigures') },
{ id: 'light_swords', name: 'Light Swords', stars: toStars(8), discount: 5, emoji: '⚔️', image_url: giftImage('lightswords') },
{ id: 'moon_pendants', name: 'Moon Pendants', stars: toStars(8), discount: 5, emoji: '🌙', image_url: giftImage('moonpendants') },
{ id: 'swag_bags', name: 'Swag Bags', stars: toStars(8), discount: 5, emoji: '👜', image_url: giftImage('swagbags') },
{ id: 'witch_hats', name: 'Witch Hats', stars: toStars(8), discount: 5, emoji: '🧙', image_url: giftImage('witchhats') },
{ id: 'bday_candles', name: 'B-Day Candles', stars: toStars(7), discount: 5, emoji: '🎂', image_url: giftImage('bdaycandles') },
{ id: 'bow_ties', name: 'Bow Ties', stars: toStars(7), discount: 5, emoji: '🎀', image_url: giftImage('bowties') },
{ id: 'clover_pins', name: 'Clover Pins', stars: toStars(7), discount: 5, emoji: '🍀', image_url: giftImage('cloverpins') },
{ id: 'cookie_hearts', name: 'Cookie Hearts', stars: toStars(7), discount: 5, emoji: '🍪', image_url: giftImage('cookiehearts') },
{ id: 'desk_calendars', name: 'Desk Calendars', stars: toStars(7), discount: 5, emoji: '📅', image_url: giftImage('deskcalendars') },
{ id: 'ginger_cookies', name: 'Ginger Cookies', stars: toStars(7), discount: 5, emoji: '🍪', image_url: giftImage('gingercookies') },
{ id: 'lush_bouquets', name: 'Lush Bouquets', stars: toStars(7), discount: 5, emoji: '💐', image_url: giftImage('lushbouquets') },
{ id: 'mousse_cakes', name: 'Mousse Cakes', stars: toStars(7), discount: 5, emoji: '🍰', image_url: giftImage('moussecakes') },
{ id: 'party_sparklers', name: 'Party Sparklers', stars: toStars(7), discount: 5, emoji: '🎇', image_url: giftImage('partysparklers') },
{ id: 'pretty_posies', name: 'Pretty Posies', stars: toStars(7), discount: 5, emoji: '🌷', image_url: giftImage('prettyposies') },
{ id: 'restless_jars', name: 'Restless Jars', stars: toStars(7), discount: 5, emoji: '🏺', image_url: giftImage('restlessjars') },
{ id: 'snoop_doggs', name: 'Snoop Doggs', stars: toStars(7), discount: 5, emoji: '🐶', image_url: giftImage('snoopdoggs') },
{ id: 'spring_baskets', name: 'Spring Baskets', stars: toStars(7), discount: 5, emoji: '🧺', image_url: giftImage('springbaskets') },
{ id: 'timeless_books', name: 'Timeless Books', stars: toStars(7), discount: 5, emoji: '📚', image_url: giftImage('timelessbooks') },
{ id: 'winter_wreaths', name: 'Winter Wreaths', stars: toStars(7), discount: 5, emoji: '🎄', image_url: giftImage('winterwreaths') },
{ id: 'big_years', name: 'Big Years', stars: toStars(6), discount: 5, emoji: '🎉', image_url: giftImage('bigyears') },
{ id: 'candy_canes', name: 'Candy Canes', stars: toStars(6), discount: 5, emoji: '🍭', image_url: giftImage('candycanes') },
{ id: 'chill_flames', name: 'Chill Flames', stars: toStars(6), discount: 5, emoji: '🔥', image_url: giftImage('chillflames') },
{ id: 'easter_eggs', name: 'Easter Eggs', stars: toStars(6), discount: 5, emoji: '🥚', image_url: giftImage('eastereggs') },
{ id: 'fresh_socks', name: 'Fresh Socks', stars: toStars(6), discount: 5, emoji: '🧦', image_url: giftImage('freshsocks') },
{ id: 'happy_brownies', name: 'Happy Brownies', stars: toStars(6), discount: 5, emoji: '🍫', image_url: giftImage('happybrownies') },
{ id: 'holiday_drinks', name: 'Holiday Drinks', stars: toStars(6), discount: 5, emoji: '🥤', image_url: giftImage('holidaydrinks') },
{ id: 'hypno_lollipops', name: 'Hypno Lollipops', stars: toStars(6), discount: 5, emoji: '🍭', image_url: giftImage('hypnolollipops') },
{ id: 'ice_creams', name: 'Ice Creams', stars: toStars(6), discount: 5, emoji: '🍦', image_url: giftImage('icecreams') },
{ id: 'instant_ramens', name: 'Instant Ramens', stars: toStars(6), discount: 5, emoji: '🍜', image_url: giftImage('instantramens') },
{ id: 'jacks_box', name: "Jacks-in-the-Box", stars: toStars(6), discount: 5, emoji: '🎁', image_url: giftImage('jacksinthebox') },
{ id: 'jester_hats', name: 'Jester Hats', stars: toStars(6), discount: 5, emoji: '🤡', image_url: giftImage('jesterhats') },
{ id: 'lol_pops', name: 'Lol Pops', stars: toStars(6), discount: 5, emoji: '🍭', image_url: giftImage('lolpops') },
{ id: 'lunar_snakes', name: 'Lunar Snakes', stars: toStars(6), discount: 5, emoji: '🐍', image_url: giftImage('lunarsnakes') },
{ id: 'money_pots', name: 'Money Pots', stars: toStars(6), discount: 5, emoji: '💰', image_url: giftImage('moneypots') },
{ id: 'mood_packs', name: 'Mood Packs', stars: toStars(6), discount: 5, emoji: '🎭', image_url: giftImage('moodpacks') },
{ id: 'pet_snakes', name: 'Pet Snakes', stars: toStars(6), discount: 5, emoji: '🐍', image_url: giftImage('petsnakes') },
{ id: 'pool_floats', name: 'Pool Floats', stars: toStars(6), discount: 5, emoji: '🛟', image_url: giftImage('poolfloats') },
{ id: 'snake_boxes', name: 'Snake Boxes', stars: toStars(6), discount: 5, emoji: '📦', image_url: giftImage('snakeboxes') },
{ id: 'star_notepads', name: 'Star Notepads', stars: toStars(6), discount: 5, emoji: '⭐', image_url: giftImage('starnotepads') },
{ id: 'stellar_rockets', name: 'Stellar Rockets', stars: toStars(6), discount: 5, emoji: '🚀', image_url: giftImage('stellarrockets') },
{ id: 'tama_gadgets', name: 'Tama Gadgets', stars: toStars(6), discount: 5, emoji: '🎮', image_url: giftImage('tamagadgets') },
{ id: 'vice_creams', name: 'Vice Creams', stars: toStars(6), discount: 5, emoji: '🍦', image_url: giftImage('vicecreams') },
{ id: 'victory_medals', name: 'Victory Medals', stars: toStars(6), discount: 5, emoji: '🏅', image_url: giftImage('victorymedals') },
{ id: 'whip_cupcakes', name: 'Whip Cupcakes', stars: toStars(6), discount: 5, emoji: '🧁', image_url: giftImage('whipcupcakes') },
{ id: 'xmas_stockings', name: 'Xmas Stockings', stars: toStars(6), discount: 5, emoji: '🧦', image_url: giftImage('xmasstockings') },
{ id: 'magic_potions_extra', name: 'Magic Potions', stars: toStars(75), discount: 10, emoji: '🧪', image_url: giftImage('magicpotions') },
{ id: 'vintage_cigars', name: 'Vintage Cigars', stars: toStars(49), discount: 10, emoji: '🚬', image_url: giftImage('vintagecigars') },
{ id: 'signet_rings', name: 'Signet Rings', stars: toStars(44), discount: 10, emoji: '💍', image_url: giftImage('signetrings') },
{ id: 'eternal_roses', name: 'Eternal Roses', stars: toStars(35), discount: 5, emoji: '🌹', image_url: giftImage('eternalroses') },
{ id: 'trapped_hearts', name: 'Trapped Hearts', stars: toStars(22), discount: 5, emoji: '💘', image_url: giftImage('trappedhearts') },
{ id: 'skull_flowers', name: 'Skull Flowers', stars: toStars(14), discount: 5, emoji: '💀', image_url: giftImage('skullflowers') },
{ id: 'berry_boxes', name: 'Berry Boxes', stars: toStars(12), discount: 5, emoji: '🍓', image_url: giftImage('berryboxes') },
{ id: 'evil_eyes', name: 'Evil Eyes', stars: toStars(12), discount: 5, emoji: '👁️', image_url: giftImage('evileyes') },
{ id: 'jelly_bunnies', name: 'Jelly Bunnies', stars: toStars(11), discount: 5, emoji: '🐰', image_url: giftImage('jellybunnies') },
{ id: 'santa_hats', name: 'Santa Hats', stars: toStars(9), discount: 5, emoji: '🎅', image_url: giftImage('santahats') },
{ id: 'spy_agarics', name: 'Spy Agarics', stars: toStars(8), discount: 5, emoji: '🍄', image_url: giftImage('spyagarics') },
{ id: 'hex_pots', name: 'Hex Pots', stars: toStars(7), discount: 5, emoji: '🏺', image_url: giftImage('hexpots') },
{ id: 'homemade_cakes', name: 'Homemade Cakes', stars: toStars(7), discount: 5, emoji: '🍰', image_url: giftImage('homemadecakes') },
{ id: 'spiced_wines', name: 'Spiced Wines', stars: toStars(7), discount: 5, emoji: '🍷', image_url: giftImage('spicedwines') }
];

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      silver INTEGER NOT NULL DEFAULT 0,
      free_spins INTEGER NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referred_by BIGINT,
      ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_xp_date DATE,
      ADD COLUMN IF NOT EXISTS rank_bonus_openings BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selected_wings TEXT NOT NULL DEFAULT 'auto',
      ADD COLUMN IF NOT EXISTS admin_profile_grant_applied BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS spin_history (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      prize_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prize_claims (
      id BIGSERIAL PRIMARY KEY,
      spin_history_id BIGINT NOT NULL UNIQUE REFERENCES spin_history(id),
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      prize_type TEXT NOT NULL CHECK (prize_type IN ('ordinary', 'unusual', 'rare')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    ALTER TABLE prize_claims DROP CONSTRAINT IF EXISTS prize_claims_prize_type_check;
    ALTER TABLE prize_claims ADD CONSTRAINT prize_claims_prize_type_check
      CHECK (prize_type IN ('ordinary', 'unusual', 'rare'));

    ALTER TABLE prize_claims
      ADD COLUMN IF NOT EXISTS prize_name TEXT,
      ADD COLUMN IF NOT EXISTS prize_stars INTEGER,
      ADD COLUMN IF NOT EXISTS prize_image_url TEXT;

    -- Быстрая выдача последних NFT-выигрышей в ленте и профиле.
    CREATE INDEX IF NOT EXISTS prize_claims_recent_named_idx
      ON prize_claims(created_at DESC)
      WHERE prize_name IS NOT NULL AND prize_name <> '';
    CREATE INDEX IF NOT EXISTS prize_claims_user_recent_named_idx
      ON prize_claims(telegram_id, created_at DESC)
      WHERE prize_name IS NOT NULL AND prize_name <> '';

    CREATE TABLE IF NOT EXISTS user_inventory (
      id BIGSERIAL PRIMARY KEY,
      source_claim_id BIGINT NOT NULL UNIQUE REFERENCES prize_claims(id),
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      prize_type TEXT NOT NULL CHECK (prize_type IN ('ordinary', 'unusual', 'rare')),
      prize_name TEXT NOT NULL,
      prize_stars INTEGER NOT NULL DEFAULT 0,
      prize_image_url TEXT,
      status TEXT NOT NULL DEFAULT 'owned'
        CHECK (status IN ('owned', 'withdraw_pending', 'withdrawn', 'consumed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_inventory_owner_idx
      ON user_inventory(telegram_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id BIGSERIAL PRIMARY KEY,
      inventory_id BIGINT NOT NULL REFERENCES user_inventory(id),
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_one_pending_per_item
      ON withdrawal_requests(inventory_id) WHERE status = 'pending';

    INSERT INTO user_inventory
      (source_claim_id, telegram_id, prize_type, prize_name, prize_stars,
       prize_image_url, status, created_at)
    SELECT c.id, c.telegram_id, c.prize_type, c.prize_name,
           COALESCE(c.prize_stars, 0), c.prize_image_url,
           CASE WHEN c.status = 'done' THEN 'withdrawn' ELSE 'owned' END,
           c.created_at
    FROM prize_claims c
    WHERE c.prize_name IS NOT NULL AND c.prize_name <> ''
    ON CONFLICT (source_claim_id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS bot_payments (
      charge_id TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      stars INTEGER NOT NULL,
      spins INTEGER NOT NULL,
      silver INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE bot_payments
      ADD COLUMN IF NOT EXISTS silver INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS bot_legacy_migrations (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      legacy_spins INTEGER NOT NULL,
      legacy_referrals INTEGER NOT NULL,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO prize_claims (spin_history_id, telegram_id, prize_type)
    SELECT id, telegram_id, prize_type
    FROM spin_history
    WHERE prize_type IN ('ordinary', 'unusual', 'rare')
    ON CONFLICT (spin_history_id) DO NOTHING;

    INSERT INTO user_inventory
      (source_claim_id, telegram_id, prize_type, prize_name, prize_stars, prize_image_url, status, created_at)
    SELECT c.id, c.telegram_id, c.prize_type, c.prize_name,
           COALESCE(c.prize_stars, 0), c.prize_image_url,
           CASE WHEN c.status = 'done' THEN 'withdrawn' ELSE 'owned' END,
           c.created_at
    FROM prize_claims c
    WHERE c.prize_name IS NOT NULL AND c.prize_name <> ''
    ON CONFLICT (source_claim_id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS topup_requests (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      stars INTEGER NOT NULL CHECK (stars > 0),
      recipient TEXT NOT NULL
        CHECK (recipient IN ('@traptrap4', '@RichGues')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS gift_orders (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5000),
      discount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN (
          'pending_payment',
          'paid',
          'completed',
          'cancelled'
        )),
      telegram_charge_id TEXT UNIQUE,
      provider_charge_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );

    ALTER TABLE gift_orders
      DROP CONSTRAINT IF EXISTS gift_orders_stars_check,
      DROP CONSTRAINT IF EXISTS gift_orders_stars_range_check;
    ALTER TABLE gift_orders
      ADD CONSTRAINT gift_orders_stars_range_check
      CHECK (stars BETWEEN 1 AND 5000);

    CREATE INDEX IF NOT EXISTS gift_orders_user_idx
      ON gift_orders(telegram_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS gift_orders_status_idx
      ON gift_orders(status, created_at DESC);


    CREATE TABLE IF NOT EXISTS rocket_rounds (
      id BIGSERIAL PRIMARY KEY,
      crash_at NUMERIC(6,2) NOT NULL CHECK (crash_at >= 1.01 AND crash_at <= 10.00),
      starts_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','running','crashed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      crashed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS rocket_rounds_recent_idx ON rocket_rounds(id DESC);
    CREATE TABLE IF NOT EXISTS rocket_bets (
      id BIGSERIAL PRIMARY KEY,
      round_id BIGINT NOT NULL REFERENCES rocket_rounds(id),
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      stake_kind TEXT NOT NULL CHECK (stake_kind IN ('silver','nft')),
      stake_amount INTEGER NOT NULL CHECK (stake_amount > 0),
      inventory_id BIGINT REFERENCES user_inventory(id),
      nft_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cashed_out','crashed')),
      cashout_multiplier NUMERIC(6,2),
      payout_silver INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at TIMESTAMPTZ,
      UNIQUE(round_id, telegram_id)
    );
    CREATE INDEX IF NOT EXISTS rocket_bets_round_idx ON rocket_bets(round_id, status);
    CREATE INDEX IF NOT EXISTS rocket_bets_user_idx ON rocket_bets(telegram_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS rocket_free_entries (
      id BIGSERIAL PRIMARY KEY,
      round_id BIGINT NOT NULL REFERENCES rocket_rounds(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(round_id, telegram_id)
    );
    CREATE INDEX IF NOT EXISTS rocket_free_entries_round_idx ON rocket_free_entries(round_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS nft_battles (
      id BIGSERIAL PRIMARY KEY,
      creator_id BIGINT NOT NULL REFERENCES users(telegram_id),
      opponent_id BIGINT REFERENCES users(telegram_id),
      spins INTEGER NOT NULL CHECK (spins BETWEEN 5 AND 15),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'finished', 'cancelled')),
      creator_result JSONB,
      opponent_result JSONB,
      creator_score BIGINT NOT NULL DEFAULT 0,
      opponent_score BIGINT NOT NULL DEFAULT 0,
      winner_id BIGINT REFERENCES users(telegram_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS nft_battles_lobby_idx
      ON nft_battles(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS nft_battles_creator_idx
      ON nft_battles(creator_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS nft_battles_opponent_idx
      ON nft_battles(opponent_id, created_at DESC);
  `);
  await initProgressionDatabase(pool);
  await initMiniGamesDatabase(pool);
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

function verifyTelegram(initData) {
  if (!initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));

    if (!hash || !authDate) return null;
    if (Date.now() / 1000 - authDate > 86400) return null;
    if (authDate > Date.now() / 1000 + 60) return null;

    const entries = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b));

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(calculatedHash, 'hex');

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) return null;

    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

function getTelegramUser(req) {
  return verifyTelegram(req.headers['x-telegram-init-data']);
}

function getReferralId(req) {
  try {
    const params = new URLSearchParams(
      req.headers['x-telegram-init-data'] || ''
    );

    const startParam = params.get('start_param') || '';
    const match = startParam.match(/^ref_(\d+)$/);

    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 10000) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });

    req.on('error', reject);
  });
}

async function ensureUser(user, req) {
  const telegramId = String(user.id);
  const referralId = getReferralId(req);

  // Для существующего пользователя — один SQL-запрос вместо
  // подключения, транзакции и отдельных INSERT/UPDATE.
  const upsert = await pool.query(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (telegram_id) DO UPDATE
      SET username = EXCLUDED.username,
          first_name = EXCLUDED.first_name
    RETURNING (xmax = 0) AS was_created
  `, [
    telegramId,
    user.username || null,
    user.first_name || null
  ]);

  if (upsert.rows[0]?.was_created) {
    await awardXp(pool, telegramId, 50, 'welcome', `welcome:${telegramId}`);
  }

  // Разовая стартовая выдача только аккаунту с точным username @RichGues.
  await pool.query(`
    UPDATE users
    SET xp = GREATEST(xp, 625124950),
        rank_bonus_openings = GREATEST(rank_bonus_openings, 5000),
        admin_profile_grant_applied = TRUE
    WHERE telegram_id = $1
      AND LOWER(COALESCE(username, '')) = 'richgues'
      AND (admin_profile_grant_applied = FALSE OR xp < 625124950 OR rank_bonus_openings < 5000)
  `, [telegramId]);

  // Реферальные начисления нужны только при первом создании аккаунта.
  if (!upsert.rows[0]?.was_created || !referralId || referralId === telegramId) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const referrer = await client.query(`
      UPDATE users
      SET referral_count = referral_count + 1
      WHERE telegram_id = $1
      RETURNING referral_count
    `, [referralId]);

    if (referrer.rowCount === 1) {
      await client.query(`
        UPDATE users
        SET referred_by = $1
        WHERE telegram_id = $2
      `, [referralId, telegramId]);

      await recordActivity(client, referralId, 'referral_completed', `referral:${telegramId}`);

      const count = Number(referrer.rows[0].referral_count);
      if (count % 10 === 0) {
        await client.query(`
          UPDATE users
          SET free_spins = free_spins + 3
          WHERE telegram_id = $1
        `, [referralId]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireAdmin(req) {
  const user = getTelegramUser(req);

  return user && String(user.id) === String(ADMIN_ID)
    ? user
    : null;
}

async function createTelegramInvoice(order) {
  const payload = [
    'gift',
    order.id,
    order.telegram_id,
    order.stars
  ].join(':');

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: order.product_name,
        description: `Покупка подарка GIFTSDROP MARKET. Заказ №${order.id}`,
        payload,
        currency: 'XTR',
        prices: [
          {
            label: order.product_name,
            amount: order.stars
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(
      data.description || 'Telegram не создал счёт'
    );
  }

  return data.result;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Проверка заказа перед подтверждением оплаты Telegram
    if (
      url.pathname === '/api/internal/store/validate' &&
      req.method === 'POST'
    ) {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) {
        return send(res, 403, {
          valid: false,
          error: 'Доступ запрещён'
        });
      }

      const body = await readBody(req);

      const orderId = String(body.order_id || '');
      const telegramId = String(body.telegram_id || '');
      const stars = Number(body.stars);

      if (
        !/^\d+$/.test(orderId) ||
        !/^\d+$/.test(telegramId) ||
        !Number.isSafeInteger(stars) ||
        stars < 1 ||
        stars > 5000 ||
        body.currency !== 'XTR'
      ) {
        return send(res, 400, {
          valid: false,
          error: 'Некорректные данные'
        });
      }

      const result = await pool.query(
        `SELECT id, telegram_id, stars, status
         FROM gift_orders
         WHERE id = $1`,
        [orderId]
      );

      if (!result.rowCount) {
        return send(res, 404, {
          valid: false,
          error: 'Заказ не найден'
        });
      }

      const order = result.rows[0];

      const valid =
        String(order.telegram_id) === telegramId &&
        Number(order.stars) === stars &&
        order.status === 'pending_payment';

      return send(res, 200, {
        valid
      });
    }

    // Внутреннее подтверждение оплаты от Python-бота
    if (
      url.pathname === '/api/internal/store/paid' &&
      req.method === 'POST'
    ) {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const body = await readBody(req);
      const orderId = String(body.order_id || '');
      const telegramId = String(body.telegram_id || '');
      const stars = Number(body.stars);
      const chargeId = String(body.charge_id || '');

      if (
        !/^\d+$/.test(orderId) ||
        !/^\d+$/.test(telegramId) ||
        !Number.isSafeInteger(stars) ||
        stars < 1 ||
        stars > 5000 ||
        body.currency !== 'XTR' ||
        !chargeId
      ) {
        return send(res, 400, {
          error: 'Некорректные данные платежа'
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM gift_orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );

        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, {
            error: 'Заказ не найден'
          });
        }

        const order = result.rows[0];

        if (
          String(order.telegram_id) !== telegramId ||
          Number(order.stars) !== stars
        ) {
          await client.query('ROLLBACK');
          return send(res, 400, {
            error: 'Данные платежа не совпадают с заказом'
          });
        }

        if (order.status === 'paid' || order.status === 'completed') {
          if (order.telegram_charge_id === chargeId) {
            await client.query('COMMIT');
            return send(res, 200, { success: true, already_paid: true });
          }

          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заказ уже оплачен другим платежом'
          });
        }

        if (order.status !== 'pending_payment') {
          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заказ нельзя оплатить'
          });
        }

        await client.query(`
          UPDATE gift_orders
          SET status = 'paid',
              telegram_charge_id = $1,
              provider_charge_id = $2,
              paid_at = NOW()
          WHERE id = $3
        `, [
          chargeId,
          body.provider_charge_id || null,
          orderId
        ]);

        await client.query('COMMIT');

        return send(res, 200, { success: true });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Shared account API for the Telegram bot. Protected by the bot token.
    if (url.pathname === '/api/internal/bot/user' && req.method === 'POST') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const body = await readBody(req);
      const telegramId = String(body.telegram_id || '');
      const legacySpins = body.legacy_spins;
      const legacyReferrals = body.legacy_referrals;
      if (!/^\d+$/.test(telegramId) ||
          (legacySpins !== null && legacySpins !== undefined &&
           (!Number.isSafeInteger(Number(legacySpins)) || Number(legacySpins) < 0)) ||
          (legacyReferrals !== null && legacyReferrals !== undefined &&
           (!Number.isSafeInteger(Number(legacyReferrals)) || Number(legacyReferrals) < 0))) {
        return send(res, 400, { error: 'Некорректный Telegram ID или старый баланс' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO users (telegram_id, username, first_name, free_spins, referral_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (telegram_id) DO NOTHING RETURNING telegram_id`,
          [telegramId, body.username || null, body.first_name || null,
           legacySpins === null || legacySpins === undefined ? 3 : Number(legacySpins),
           legacyReferrals === null || legacyReferrals === undefined ? 0 : Number(legacyReferrals)]
        );
        await client.query(
          'UPDATE users SET username = $1, first_name = $2 WHERE telegram_id = $3',
          [body.username || null, body.first_name || null, telegramId]
        );
        if (legacySpins !== null && legacySpins !== undefined) {
          const migration = await client.query(
            `INSERT INTO bot_legacy_migrations (telegram_id, legacy_spins, legacy_referrals)
             VALUES ($1, $2, $3)
             ON CONFLICT (telegram_id) DO NOTHING
             RETURNING telegram_id`,
            [telegramId, Number(legacySpins),
             legacyReferrals === null || legacyReferrals === undefined ? 0 : Number(legacyReferrals)]
          );
          if (migration.rowCount === 1 && inserted.rowCount === 0) {
            await client.query(
              `UPDATE users
               SET free_spins = GREATEST(free_spins, $1),
                   referral_count = GREATEST(referral_count, $2)
               WHERE telegram_id = $3`,
              [Number(legacySpins),
               legacyReferrals === null || legacyReferrals === undefined ? 0 : Number(legacyReferrals),
               telegramId]
            );
          }
        }
        const referralId = String(body.referral_id || '');
        if (inserted.rowCount === 1 && /^\d+$/.test(referralId) && referralId !== telegramId) {
          const referrer = await client.query(
            'UPDATE users SET referral_count = referral_count + 1 WHERE telegram_id = $1 RETURNING referral_count',
            [referralId]
          );
          if (referrer.rowCount === 1) {
            await client.query('UPDATE users SET referred_by = $1 WHERE telegram_id = $2', [referralId, telegramId]);
            if (Number(referrer.rows[0].referral_count) % 10 === 0) {
              await client.query('UPDATE users SET free_spins = free_spins + 3 WHERE telegram_id = $1', [referralId]);
            }
          }
        }
        const account = await client.query(
          'SELECT silver, free_spins, referral_count FROM users WHERE telegram_id = $1', [telegramId]
        );
        await client.query('COMMIT');
        const row = account.rows[0];
        return send(res, 200, {
          created: inserted.rowCount === 1,
          silver: Number(row.silver),
          free_spins: Number(row.free_spins),
          referral_count: Number(row.referral_count),
          remaining_referrals: 10 - (Number(row.referral_count) % 10)
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    if (url.pathname === '/api/internal/bot/spin' && req.method === 'POST') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const body = await readBody(req);
      const telegramId = String(body.telegram_id || '');
      if (!/^\d+$/.test(telegramId)) return send(res, 400, { error: 'Некорректный Telegram ID' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE', [telegramId]);
        if (!locked.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, { error: 'Пользователь не найден' });
        }
        const account = locked.rows[0];
        if (Number(account.free_spins) <= 0 && Number(account.silver) < 20) {
          await client.query('ROLLBACK');
          return send(res, 400, { error: 'Недостаточно серебра. Одна прокрутка стоит 20 серебра.' });
        }
        if (Number(account.free_spins) > 0) {
          await client.query('UPDATE users SET free_spins = free_spins - 1 WHERE telegram_id = $1', [telegramId]);
        } else {
          await client.query('UPDATE users SET silver = silver - 20 WHERE telegram_id = $1', [telegramId]);
        }
        const roll = crypto.randomInt(100000);
        const prize = roll >= 99999 ? 'rare' : (roll >= 94999 ? 'unusual' : (roll >= 79999 ? 'ordinary' : 'nothing'));
        const history = await client.query(
          'INSERT INTO spin_history (telegram_id, prize_type) VALUES ($1, $2) RETURNING id',
          [telegramId, prize]
        );
        await awardXp(client, telegramId, 10, 'spin', `spin:${history.rows[0].id}`);
        await recordActivity(client, telegramId, 'spin_completed', `spin:${history.rows[0].id}`);
        let claimId = null;
        if (prize !== 'nothing') {
          const claim = await client.query(
            'INSERT INTO prize_claims (spin_history_id, telegram_id, prize_type) VALUES ($1, $2, $3) RETURNING id',
            [history.rows[0].id, telegramId, prize]
          );
          claimId = claim.rows[0].id;
          await recordActivity(client, telegramId, 'nft_collected', `claim:${claimId}`);
        }
        const updated = await client.query('SELECT silver, free_spins FROM users WHERE telegram_id = $1', [telegramId]);
        await client.query('COMMIT');
        return send(res, 200, {
          prize,
          silver: Number(updated.rows[0].silver),
          free_spins: Number(updated.rows[0].free_spins),
          claim_id: claimId
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    if (url.pathname === '/api/internal/bot/silver-payment' && req.method === 'POST') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const body = await readBody(req);
      const telegramId = String(body.telegram_id || '');
      const amount = Number(body.amount);
      const stars = Number(body.stars);
      const chargeId = String(body.charge_id || '');
      if (!/^\d+$/.test(telegramId) || !Number.isSafeInteger(amount) ||
          amount < 1 || amount > 1000 || stars !== amount || !chargeId) {
        return send(res, 400, { error: 'Некорректные данные пополнения серебра' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING',
          [telegramId]
        );
        const payment = await client.query(
          `INSERT INTO bot_payments (charge_id, telegram_id, stars, spins, silver)
           VALUES ($1, $2, $3, 0, $4)
           ON CONFLICT (charge_id) DO NOTHING RETURNING charge_id`,
          [chargeId, telegramId, stars, amount]
        );
        if (payment.rowCount === 1) {
          await client.query(
            'UPDATE users SET silver = silver + $1 WHERE telegram_id = $2',
            [amount, telegramId]
          );
        }
        const account = await client.query(
          'SELECT silver FROM users WHERE telegram_id = $1', [telegramId]
        );
        await client.query('COMMIT');
        return send(res, 200, {
          success: true,
          already_processed: payment.rowCount === 0,
          credited_silver: payment.rowCount === 1 ? amount : 0,
          silver: Number(account.rows[0].silver)
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    if (url.pathname === '/api/internal/bot/legacy-payment' && req.method === 'POST') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const body = await readBody(req);
      const telegramId = String(body.telegram_id || '');
      const count = Number(body.count);
      const stars = Number(body.stars);
      const chargeId = String(body.charge_id || '');
      const expectedStars = count === 1 ? 5 : 15;
      if (!/^\d+$/.test(telegramId) || ![1, 3].includes(count) || stars !== expectedStars || !chargeId) {
        return send(res, 400, { error: 'Некорректные данные старого платежа' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING', [telegramId]);
        const payment = await client.query(
          `INSERT INTO bot_payments (charge_id, telegram_id, stars, spins)
           VALUES ($1, $2, $3, $4) ON CONFLICT (charge_id) DO NOTHING RETURNING charge_id`,
          [chargeId, telegramId, stars, count]
        );
        if (payment.rowCount === 1) {
          await client.query('UPDATE users SET free_spins = free_spins + $1 WHERE telegram_id = $2', [count, telegramId]);
        }
        const account = await client.query('SELECT free_spins FROM users WHERE telegram_id = $1', [telegramId]);
        await client.query('COMMIT');
        return send(res, 200, {
          success: true,
          already_processed: payment.rowCount === 0,
          credited_spins: payment.rowCount === 1 ? count : 0,
          free_spins: Number(account.rows[0].free_spins)
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    if (url.pathname === '/api/internal/bot/prizes' && req.method === 'GET') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const result = await pool.query(
        "SELECT id, telegram_id, prize_type, created_at FROM prize_claims WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
      );
      return send(res, 200, { claims: result.rows });
    }

    if (url.pathname.startsWith('/api/internal/bot/prizes/') &&
        url.pathname.endsWith('/done') && req.method === 'POST') {
      if (req.headers['x-bot-token'] !== BOT_TOKEN) return send(res, 403, { error: 'Доступ запрещён' });
      const body = await readBody(req);
      if (String(body.admin_id || '') !== String(ADMIN_ID)) return send(res, 403, { error: 'Доступ запрещён' });
      const claimId = url.pathname.split('/').slice(-2, -1)[0];
      if (!/^\d+$/.test(claimId)) return send(res, 400, { error: 'Некорректный номер заявки' });
      const result = await pool.query(
        "UPDATE prize_claims SET status = 'done', processed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id",
        [claimId]
      );
      if (!result.rowCount) return send(res, 404, { error: 'Заявка не найдена или уже обработана' });
      return send(res, 200, { success: true });
    }

    // Публичная лента реальных выигрышей: без Telegram ID и личных данных.
    if (url.pathname === '/api/wins/recent' && req.method === 'GET') {
      const result = await pool.query(
        `SELECT prize_type, prize_name, prize_stars, created_at
         FROM prize_claims
         WHERE prize_name IS NOT NULL AND prize_name <> ''
         ORDER BY created_at DESC
         LIMIT 24`
      );
      return send(res, 200, {
        wins: result.rows.map(row => ({
          prize_type: row.prize_type,
          prize_name: row.prize_name,
          prize_stars: Number(row.prize_stars) || 0,
          created_at: row.created_at
        }))
      });
    }

    // Каталог магазина
    if (
      url.pathname === '/api/store/catalog' &&
      req.method === 'GET'
    ) {
      return send(res, 200, {
        products: PRODUCTS.map(product => ({
          ...product,
          old_stars: product.stars + product.discount
        }))
      });
    }

    // Создание заказа и Telegram-счёта
    if (
      url.pathname === '/api/store/invoice' &&
      req.method === 'POST'
    ) {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const body = await readBody(req);
      const product = PRODUCTS.find(
        item => item.id === String(body.product_id || '')
      );

      if (!product) {
        return send(res, 404, {
          error: 'Товар не найден'
        });
      }

      const created = await pool.query(`
        INSERT INTO gift_orders (
          telegram_id,
          product_id,
          product_name,
          stars,
          discount
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, telegram_id, product_name, stars
      `, [
        String(user.id),
        product.id,
        product.name,
        product.stars,
        product.discount
      ]);

      const order = created.rows[0];

      try {
        const invoiceLink = await createTelegramInvoice(order);

        return send(res, 201, {
          order_id: order.id,
          invoice_link: invoiceLink,
          stars: order.stars
        });
      } catch (error) {
        await pool.query(`
          UPDATE gift_orders
          SET status = 'cancelled'
          WHERE id = $1 AND status = 'pending_payment'
        `, [order.id]);

        throw error;
      }
    }

    // История заказов покупателя
    if (
      url.pathname === '/api/store/orders' &&
      req.method === 'GET'
    ) {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      const result = await pool.query(`
        SELECT
          id,
          product_name,
          stars,
          status,
          created_at,
          paid_at,
          completed_at
        FROM gift_orders
        WHERE telegram_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `, [String(user.id)]);

      return send(res, 200, {
        orders: result.rows
      });
    }

    // Выигранные NFT: заявки администратору
    if (url.pathname === '/api/admin/prizes' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return send(res, 403, { error: 'Доступ запрещён' });
      const result = await pool.query(`
        SELECT c.id, c.telegram_id, u.username, u.first_name,
               c.prize_type, c.prize_name, c.prize_stars, c.prize_image_url,
               c.status, c.created_at, c.processed_at
        FROM prize_claims c
        JOIN users u ON u.telegram_id = c.telegram_id
        ORDER BY CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END,
                 c.created_at DESC
        LIMIT 100
      `);
      return send(res, 200, { claims: result.rows });
    }

    const prizeDone = url.pathname.match(/^\/api\/admin\/prizes\/(\d+)\/done$/);
    if (prizeDone && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return send(res, 403, { error: 'Доступ запрещён' });
      const result = await pool.query(`
        UPDATE prize_claims
        SET status = 'done', processed_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING id
      `, [prizeDone[1]]);
      if (!result.rowCount) return send(res, 409, { error: 'Заявка уже выполнена или не найдена' });
      return send(res, 200, { success: true });
    }

    // Админ-панель: заказы магазина
    if (
      url.pathname === '/api/admin/store/orders' &&
      req.method === 'GET'
    ) {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        SELECT
          o.id,
          o.telegram_id,
          u.username,
          u.first_name,
          o.product_name,
          o.stars,
          o.discount,
          o.status,
          o.created_at,
          o.paid_at
        FROM gift_orders o
        JOIN users u ON u.telegram_id = o.telegram_id
        WHERE o.status IN ('paid', 'completed')
        ORDER BY
          CASE WHEN o.status = 'paid' THEN 0 ELSE 1 END,
          o.created_at DESC
        LIMIT 100
      `);

      return send(res, 200, {
        orders: result.rows
      });
    }

    // Отметить подарок как отправленный
    const giftDone = url.pathname.match(
      /^\/api\/admin\/store\/orders\/(\d+)\/done$/
    );

    if (giftDone && req.method === 'POST') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        UPDATE gift_orders
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = $1
          AND status = 'paid'
        RETURNING id
      `, [giftDone[1]]);

      if (!result.rowCount) {
        return send(res, 409, {
          error: 'Заказ не найден или уже выполнен'
        });
      }

      return send(res, 200, {
        success: true,
        message: 'Заказ отмечен как выполненный'
      });
    }

    // Аватар текущего пользователя: Telegram Bot API, только для владельца initData.
    if (url.pathname === '/api/me/avatar' && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });

      const photosResponse = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${encodeURIComponent(user.id)}&limit=1`
      );
      const photosData = await photosResponse.json();
      if (!photosResponse.ok || !photosData.ok) {
        return send(res, 502, { error: 'Не удалось получить аватар Telegram' });
      }
      const sizes = photosData.result && photosData.result.photos && photosData.result.photos[0];
      if (!sizes || !sizes.length) return send(res, 200, { photo_url: null });

      const photo = sizes[sizes.length - 1];
      const fileResponse = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(photo.file_id)}`
      );
      const fileData = await fileResponse.json();
      if (!fileResponse.ok || !fileData.ok || !fileData.result || !fileData.result.file_path) {
        return send(res, 502, { error: 'Не удалось загрузить аватар Telegram' });
      }

      const imageResponse = await fetch(
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`
      );
      if (!imageResponse.ok) return send(res, 502, { error: 'Аватар Telegram временно недоступен' });
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      if (imageBuffer.length > 2 * 1024 * 1024) {
        return send(res, 413, { error: 'Файл аватара слишком большой' });
      }
      return send(res, 200, {
        photo_url: `data:${contentType};base64,${imageBuffer.toString('base64')}`
      });
    }

    // Выбор любых уже открытых крыльев. Ранг при этом не меняется.
    if (url.pathname === '/api/me/wings' && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const body = await readBody(req);
      const selected = String(body.wing_key || 'auto');
      const chosenRank = PROFILE_RANKS.find(rank => rank.key === selected);
      if (selected !== 'auto' && (!chosenRank || chosenRank.min === 0)) {
        return send(res, 400, { error: 'Такой вариант крыльев недоступен' });
      }
      const account = await pool.query(
        'SELECT rank_bonus_openings FROM users WHERE telegram_id = $1',
        [String(user.id)]
      );
      const spins = await pool.query(
        'SELECT COUNT(*)::BIGINT AS total FROM spin_history WHERE telegram_id = $1',
        [String(user.id)]
      );
      const openings = Number(spins.rows[0].total || 0) +
        Math.max(0, Number(account.rows[0]?.rank_bonus_openings) || 0);
      if (selected !== 'auto' && openings < chosenRank.min) {
        return send(res, 403, { error: 'Сначала достигни этого ранга, чтобы открыть такие крылья' });
      }
      await pool.query(
        'UPDATE users SET selected_wings = $1 WHERE telegram_id = $2',
        [selected, String(user.id)]
      );
      return send(res, 200, { success: true, selected_wings: selected });
    }

    // Публичный поиск игроков по Telegram username.
    if (url.pathname === '/api/users/search' && req.method === 'GET') {
      if (!getTelegramUser(req)) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const query = String(url.searchParams.get('q') || '').trim().replace(/^@/, '');
      if (query.length < 2) return send(res, 200, { users: [] });
      const found = await pool.query(`
        SELECT username, first_name FROM users
        WHERE username IS NOT NULL AND username ILIKE '%' || $1 || '%'
        ORDER BY CASE WHEN LOWER(username) = LOWER($1) THEN 0 ELSE 1 END, username ASC
        LIMIT 20
      `, [query]);
      return send(res, 200, { users: found.rows });
    }

    // Публичная карточка: только статистика, без Telegram ID, баланса и инвентаря.
    if (url.pathname === '/api/users/profile' && req.method === 'GET') {
      if (!getTelegramUser(req)) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const username = String(url.searchParams.get('username') || '').trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) return send(res, 400, { error: 'Некорректный Telegram username' });
      const found = await pool.query(`
        SELECT telegram_id, username, first_name, xp, rank_bonus_openings, selected_wings
        FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1
      `, [username]);
      if (!found.rowCount) return send(res, 404, { error: 'Игрок не найден. Возможно, он ещё не запускал GiftsMoney.' });
      const player = found.rows[0], telegramId = String(found.rows[0].telegram_id);
      const [spins, payments] = await Promise.all([
        pool.query('SELECT COUNT(*)::BIGINT AS total FROM spin_history WHERE telegram_id = $1', [telegramId]),
        pool.query('SELECT COALESCE(SUM(stars),0)::BIGINT AS stars, COALESCE(SUM(silver),0)::BIGINT AS silver, COUNT(*)::BIGINT AS count FROM bot_payments WHERE telegram_id = $1 AND stars > 0', [telegramId])
      ]);
      const openings = Number(spins.rows[0].total || 0) + Math.max(0, Number(player.rank_bonus_openings) || 0);
      const rank = getProfileRank(openings), experience = Math.max(0, Number(player.xp) || 0);
      const level = getLevelStats(experience), paid = payments.rows[0];
      return send(res, 200, {
        username: player.username, first_name: player.first_name,
        level: level.level, xp: experience, total_openings: openings,
        rank_key: rank.key, rank_name: rank.name, rank_wings: rank.wings,
        selected_wings: player.selected_wings || 'auto',
        donated_stars: Number(paid.stars || 0), donated_silver: Number(paid.silver || 0),
        donation_count: Number(paid.count || 0)
      });
    }

    // Аккаунт
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      // Ежедневный опыт и событие посещения начисляются ровно один раз за UTC-день.
      await recordDailyVisit(pool, String(user.id));

      const result = await pool.query(`
        SELECT silver, free_spins, referral_count, xp, rank_bonus_openings, selected_wings
        FROM users
        WHERE telegram_id = $1
      `, [String(user.id)]);
      const account = result.rows[0];
      const referralCount = Number(account.referral_count) || 0;
      const experience = Math.max(0, Number(account.xp) || 0);
      const levelStats = getLevelStats(experience);
      const spinCount = await pool.query(
        'SELECT COUNT(*)::BIGINT AS total FROM spin_history WHERE telegram_id = $1',
        [String(user.id)]
      );
      const totalOpenings = Number(spinCount.rows[0].total || 0) + Math.max(0, Number(account.rank_bonus_openings) || 0);
      const rank = getProfileRank(totalOpenings);

      return send(res, 200, {
        ...account,
        level: levelStats.level,
        xp: experience,
        xp_progress: levelStats.xp_progress,
        xp_required: levelStats.xp_required,
        xp_to_next: levelStats.xp_to_next,
        total_openings: totalOpenings,
        rank: rank.name,
        rank_key: rank.key,
        rank_wings: rank.wings,
        selected_wings: account.selected_wings || 'auto',
        next_rank: rank.next_rank,
        rank_progress: rank.rank_progress,
        openings_to_next_rank: rank.openings_to_next,
        is_legend: rank.key === 'legend',
        progress: referralCount % 10,
        total_rewards: Math.floor(referralCount / 10) * 3,
        remaining: 10 - (referralCount % 10),
        referral_link: `https://t.me/${BOT_USERNAME}?startapp=ref_${user.id}`
      });
    }

    // Платные мини-игры: списание и создание сессии проходят одной транзакцией.
    if (url.pathname === '/api/minigames/start' && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const body = await readBody(req);
      const result = await startMiniGame(pool, String(user.id), String(body.game || ''), String(body.request_id || ''));
      return send(res, result.status, result);
    }

    const miniGameActionMatch = url.pathname.match(/^\\/api\\/minigames\\/sessions\\/([0-9a-f-]{36})\\/action$/i);
    if (miniGameActionMatch && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const body = await readBody(req);
      const result = await performMiniGameAction(pool, String(user.id), miniGameActionMatch[1], body);
      return send(res, result.status, result);
    }

    // GiftsDrop Core: единый обзор прогресса, заданий и достижений.
    if (url.pathname === '/api/core' && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      await recordDailyVisit(pool, String(user.id));
      const overview = await getCoreOverview(pool, String(user.id));
      return send(res, 200, overview);
    }

    const missionClaimPath = url.pathname.startsWith('/api/missions/') && url.pathname.endsWith('/claim');
    if (missionClaimPath && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const missionId = Number(url.pathname.split('/')[3]);
      if (!Number.isSafeInteger(missionId) || missionId < 1) return send(res, 400, { error: 'Некорректный ID задания' });
      const result = await claimMission(pool, String(user.id), missionId);
      return send(res, result.status, result.status === 200 ? { success: true, reward: result.reward } : { error: result.error || 'Задание не найдено' });
    }

    const achievementClaimPath = url.pathname.startsWith('/api/achievements/') && url.pathname.endsWith('/claim');
    if (achievementClaimPath && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const achievementId = Number(url.pathname.split('/')[3]);
      if (!Number.isSafeInteger(achievementId) || achievementId < 1) return send(res, 400, { error: 'Некорректный ID достижения' });
      const result = await claimAchievement(pool, String(user.id), achievementId);
      return send(res, result.status, result.status === 200 ? { success: true, reward: result.reward } : { error: result.error || 'Достижение не найдено' });
    }

    // Серверный NFT-инвентарь. Записи создаются только из подтверждённых выигрышей.
    if (url.pathname === '/api/me/inventory' && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const result = await pool.query(
        `SELECT id AS inventory_id, prize_type, prize_name, prize_stars,
                prize_image_url, status, created_at
         FROM user_inventory
         WHERE telegram_id = $1 AND status IN ('owned', 'withdraw_pending')
         ORDER BY created_at DESC LIMIT 100`,
        [String(user.id)]
      );
      return send(res, 200, { items: result.rows.map(row => ({
        ...row, inventory_id: Number(row.inventory_id),
        prize_stars: Number(row.prize_stars) || 0
      })) });
    }

    if (url.pathname === '/api/me/withdrawals' && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const body = await readBody(req);
      const inventoryId = String(body.inventory_id || '');
      if (!/^\d+$/.test(inventoryId)) {
        return send(res, 400, { error: 'Некорректный предмет инвентаря' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const item = await client.query(
          'SELECT * FROM user_inventory WHERE id = $1 AND telegram_id = $2 FOR UPDATE',
          [inventoryId, String(user.id)]
        );
        if (!item.rowCount || item.rows[0].status !== 'owned') {
          await client.query('ROLLBACK');
          return send(res, 409, { error: 'Предмет уже выведен или ожидает обработки' });
        }
        const request = await client.query(
          `INSERT INTO withdrawal_requests (inventory_id, telegram_id)
           VALUES ($1, $2) RETURNING id, status, created_at`,
          [inventoryId, String(user.id)]
        );
        await client.query(
          `UPDATE user_inventory SET status = 'withdraw_pending', updated_at = NOW()
           WHERE id = $1`, [inventoryId]
        );
        await client.query('COMMIT');
        return send(res, 201, { success: true, request: request.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return send(res, 409, { error: 'Заявка на этот предмет уже существует' });
        throw error;
      } finally { client.release(); }
    }

    if (url.pathname === '/api/admin/withdrawals' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return send(res, 403, { error: 'Доступ запрещён' });
      const result = await pool.query(
        `SELECT r.id, r.telegram_id, u.username, u.first_name,
                i.id AS inventory_id, i.prize_name, i.prize_stars,
                i.prize_image_url, r.status, r.created_at
         FROM withdrawal_requests r
         JOIN users u ON u.telegram_id = r.telegram_id
         JOIN user_inventory i ON i.id = r.inventory_id
         WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 100`
      );
      return send(res, 200, { requests: result.rows });
    }

    const withdrawalDecision = url.pathname.match(/^\/api\/admin\/withdrawals\/(\d+)\/(complete|reject)$/);
    if (withdrawalDecision && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return send(res, 403, { error: 'Доступ запрещён' });
      const requestId = withdrawalDecision[1];
      const action = withdrawalDecision[2];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          `SELECT r.id, r.inventory_id, r.telegram_id, r.status, i.source_claim_id
           FROM withdrawal_requests r JOIN user_inventory i ON i.id = r.inventory_id
           WHERE r.id = $1 FOR UPDATE OF r, i`, [requestId]
        );
        if (!locked.rowCount || locked.rows[0].status !== 'pending') {
          await client.query('ROLLBACK');
          return send(res, 409, { error: 'Заявка уже обработана или не найдена' });
        }
        const row = locked.rows[0];
        if (action === 'complete') {
          await client.query(
            `UPDATE user_inventory SET status = 'withdrawn', updated_at = NOW()
             WHERE id = $1 AND status = 'withdraw_pending'`, [row.inventory_id]
          );
          await client.query(
            `UPDATE prize_claims SET status = 'done', processed_at = NOW()
             WHERE id = $1 AND status = 'pending'`, [row.source_claim_id]
          );
          await client.query(
            `UPDATE withdrawal_requests SET status = 'completed', processed_at = NOW()
             WHERE id = $1`, [requestId]
          );
        } else {
          await client.query(
            `UPDATE user_inventory SET status = 'owned', updated_at = NOW()
             WHERE id = $1 AND status = 'withdraw_pending'`, [row.inventory_id]
          );
          await client.query(
            `UPDATE withdrawal_requests SET status = 'rejected', processed_at = NOW()
             WHERE id = $1`, [requestId]
          );
        }
        await client.query('COMMIT');
        return send(res, 200, { success: true, status: action === 'complete' ? 'completed' : 'rejected' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }


    // Rocket game was retired. Keep historical database records intact.
    if (url.pathname.startsWith('/api/rocket/')) {
      return send(res, 410, { error: 'Раздел Rocket удалён' });
    }

    // История NFT-выигрышей только текущего Telegram-пользователя.
    if (url.pathname === '/api/me/wins' && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const result = await pool.query(
        `SELECT prize_type, prize_name, prize_stars, prize_image_url, status, created_at
         FROM prize_claims
         WHERE telegram_id = $1 AND prize_name IS NOT NULL AND prize_name <> ''
         ORDER BY created_at DESC
         LIMIT 20`,
        [String(user.id)]
      );
      return send(res, 200, { wins: result.rows.map(row => ({
        prize_type: row.prize_type,
        prize_name: row.prize_name,
        prize_stars: Number(row.prize_stars) || 0,
        prize_image_url: row.prize_image_url || null,
        status: row.status,
        created_at: row.created_at
      })) });
    }

    // Рефералы
    if (url.pathname === '/api/referrals' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        SELECT referral_count
        FROM users
        WHERE telegram_id = $1
      `, [String(user.id)]);

      const count = Number(result.rows[0].referral_count);

      return send(res, 200, {
        referral_count: count,
        progress: count % 10,
        total_rewards: Math.floor(count / 10) * 3,
        remaining: 10 - (count % 10),
        referral_link:
          `https://t.me/${BOT_USERNAME}?startapp=ref_${user.id}`
      });
    }

    // NFT battles: two players open the same number of roulette spins.
    if (url.pathname === '/api/battles' && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const result = await pool.query(`
        SELECT b.id, b.spins, b.status, b.created_at,
               b.creator_id, b.opponent_id, b.creator_score, b.opponent_score, b.winner_id,
               c.username AS creator_username, c.first_name AS creator_first_name,
               o.username AS opponent_username, o.first_name AS opponent_first_name
        FROM nft_battles b
        JOIN users c ON c.telegram_id = b.creator_id
        LEFT JOIN users o ON o.telegram_id = b.opponent_id
        WHERE b.status = 'waiting' OR b.status = 'finished'
        ORDER BY CASE WHEN b.status = 'waiting' THEN 0 ELSE 1 END, b.created_at DESC
        LIMIT 30
      `);
      return send(res, 200, { battles: result.rows.map(row => ({
        ...row,
        id: Number(row.id),
        spins: Number(row.spins),
        creator_score: Number(row.creator_score || 0),
        opponent_score: Number(row.opponent_score || 0),
        creator_id: String(row.creator_id),
        opponent_id: row.opponent_id ? String(row.opponent_id) : null,
        winner_id: row.winner_id ? String(row.winner_id) : null
      })) });
    }

    if (url.pathname === '/api/battles' && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const body = await readBody(req);
      const spins = Number(body.spins);
      if (!Number.isInteger(spins) || spins < 5 || spins > 15) {
        return send(res, 400, { error: 'Выбери от 5 до 15 прокруток' });
      }
      await ensureUser(user, req);
      const created = await pool.query(`
        INSERT INTO nft_battles (creator_id, spins)
        VALUES ($1, $2)
        RETURNING id, spins, status, created_at
      `, [String(user.id), spins]);
      return send(res, 201, { battle: { ...created.rows[0], id: Number(created.rows[0].id), spins: Number(created.rows[0].spins) } });
    }

    const battleJoinMatch = url.pathname.match(/^\/api\/battles\/(\d+)\/join$/);
    if (battleJoinMatch && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      await ensureUser(user, req);
      const battleId = Number(battleJoinMatch[1]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const lockedBattle = await client.query(
          'SELECT * FROM nft_battles WHERE id = $1 FOR UPDATE', [battleId]
        );
        if (!lockedBattle.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, { error: 'Баттл не найден' });
        }
        const battle = lockedBattle.rows[0];
        if (battle.status !== 'waiting' || battle.opponent_id) {
          await client.query('ROLLBACK');
          return send(res, 409, { error: 'Этот баттл уже начался или завершён' });
        }
        if (String(battle.creator_id) === String(user.id)) {
          await client.query('ROLLBACK');
          return send(res, 400, { error: 'Нельзя вступить в собственный баттл' });
        }

        const ids = [String(battle.creator_id), String(user.id)].sort();
        const lockedUsers = await client.query(
          'SELECT * FROM users WHERE telegram_id = ANY($1::bigint[]) ORDER BY telegram_id FOR UPDATE',
          [ids]
        );
        const accounts = new Map(lockedUsers.rows.map(row => [String(row.telegram_id), row]));
        const spins = Number(battle.spins);
        for (const id of ids) {
          const account = accounts.get(id);
          if (!account) throw new Error('Не удалось загрузить аккаунт участника');
          const freeUsed = Math.min(spins, Number(account.free_spins));
          const paidSpins = spins - freeUsed;
          const silverCost = paidSpins * 20;
          if (Number(account.silver) < silverCost) {
            await client.query('ROLLBACK');
            return send(res, 400, {
              error: id === String(battle.creator_id)
                ? 'У создателя недостаточно прокруток или серебра для этого баттла'
                : 'Недостаточно прокруток или серебра. Нужно по 20 серебра за каждую платную прокрутку.'
            });
          }
          await client.query(
            'UPDATE users SET free_spins = free_spins - $1, silver = silver - $2 WHERE telegram_id = $3',
            [freeUsed, silverCost, id]
          );
        }

        const ordinaryGifts = [
          { id:'love_heart', name:'Love Heart', stars:15, emoji:'❤️', image_url:giftImage('loveheart') },
          { id:'teddy_bear', name:'Teddy Bear', stars:15, emoji:'🧸', image_url:giftImage('toybear') },
          { id:'gift_box', name:'Gift Box', stars:25, emoji:'🎁', image_url:giftImage('giftbox') },
          { id:'red_rose', name:'Red Rose', stars:25, emoji:'🌹', image_url:giftImage('redrose') },
          { id:'birthday_cake', name:'Birthday Cake', stars:50, emoji:'🎂', image_url:giftImage('birthdaycake') },
          { id:'bouquet', name:'Bouquet of Flowers', stars:50, emoji:'💐', image_url:giftImage('bouquetofflowers') },
          { id:'rocket', name:'Rocket', stars:50, emoji:'🚀', image_url:giftImage('rocket') },
          { id:'champagne', name:'Champagne Bottle', stars:50, emoji:'🍾', image_url:giftImage('champagne') },
          { id:'trophy', name:'Trophy', stars:100, emoji:'🏆', image_url:giftImage('trophy') },
          { id:'diamond_ring', name:'Diamond Ring', stars:100, emoji:'💍', image_url:giftImage('diamondring') },
          { id:'gem', name:'Gem', stars:100, emoji:'💎', image_url:giftImage('gem') }
        ];
        const runPlayerSpins = async (telegramId) => {
          const drops = [];
          let score = 0;
          for (let i = 0; i < spins; i++) {
            const chance = crypto.randomInt(100000);
            let prize = 'nothing';
            if (chance >= 99999) prize = 'rare';
            else if (chance >= 94999) prize = 'unusual';
            else if (chance >= 79999) prize = 'ordinary';

            const history = await client.query(
              'INSERT INTO spin_history (telegram_id, prize_type) VALUES ($1, $2) RETURNING id',
              [telegramId, prize]
            );
            let winningGift = null;
            if (prize !== 'nothing') {
              const giftPool = prize === 'ordinary'
                ? ordinaryGifts
                : PRODUCTS.filter(product => prize === 'unusual'
                  ? Number(product.stars) >= 300 && Number(product.stars) <= 1000
                  : Number(product.stars) >= 1000 && Number(product.stars) <= 10000);
              if (!giftPool.length) throw new Error('В каталоге нет подарков для выпавшей категории');
              const selected = giftPool[crypto.randomInt(giftPool.length)];
              winningGift = {
                id: selected.id,
                name: selected.name,
                stars: Number(selected.stars),
                emoji: selected.emoji || '🎁',
                image_url: selected.image_url || ''
              };
              const claim = await client.query(`
                INSERT INTO prize_claims
                  (spin_history_id, telegram_id, prize_type, prize_name, prize_stars, prize_image_url)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
              `, [history.rows[0].id, telegramId, prize, winningGift.name, winningGift.stars, winningGift.image_url]);
              await recordActivity(client, telegramId, 'nft_collected', `battle-claim:${battleId}:${telegramId}:${i}`);
              await client.query(`
                INSERT INTO user_inventory
                  (source_claim_id, telegram_id, prize_type, prize_name, prize_stars, prize_image_url)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (source_claim_id) DO NOTHING
              `, [claim.rows[0].id, telegramId, prize, winningGift.name, winningGift.stars, winningGift.image_url]);
              score += winningGift.stars;
            }
            drops.push({ prize, gift: winningGift, value: winningGift ? winningGift.stars : 0 });
          }
          await awardXp(client, telegramId, 20, 'nft_battle', `nft-battle:${battleId}:${telegramId}`);
          await recordActivity(client, telegramId, 'spin_completed', `battle-spins:${battleId}:${telegramId}`, spins);
          return { drops, score };
        };

        const creatorId = String(battle.creator_id);
        const opponentId = String(user.id);
        const creatorResult = await runPlayerSpins(creatorId);
        const opponentResult = await runPlayerSpins(opponentId);
        const winnerId = creatorResult.score === opponentResult.score
          ? null
          : (creatorResult.score > opponentResult.score ? creatorId : opponentId);
        await recordActivity(client, creatorId, 'battle_completed', `battle:${battleId}`);
        await recordActivity(client, opponentId, 'battle_completed', `battle:${battleId}`);

        await client.query(`
          UPDATE nft_battles
          SET opponent_id = $1, status = 'finished',
              creator_result = $2::jsonb, opponent_result = $3::jsonb,
              creator_score = $4, opponent_score = $5, winner_id = $6,
              finished_at = NOW()
          WHERE id = $7
        `, [
          opponentId, JSON.stringify(creatorResult.drops), JSON.stringify(opponentResult.drops),
          creatorResult.score, opponentResult.score, winnerId, battleId
        ]);
        const balances = await client.query(
          'SELECT telegram_id, silver, free_spins FROM users WHERE telegram_id = ANY($1::bigint[])',
          [ids]
        );
        await client.query('COMMIT');
        return send(res, 200, {
          success: true,
          battle: {
            id: battleId, spins, status: 'finished',
            creator_id: creatorId, opponent_id: opponentId, winner_id: winnerId,
            creator_score: creatorResult.score, opponent_score: opponentResult.score,
            creator_result: creatorResult.drops, opponent_result: opponentResult.drops
          },
          balances: balances.rows.map(row => ({
            telegram_id: String(row.telegram_id),
            silver: Number(row.silver), free_spins: Number(row.free_spins)
          }))
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const battleCancelMatch = url.pathname.match(/^\/api\/battles\/(\d+)\/cancel$/);
    if (battleCancelMatch && req.method === 'POST') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const battleId = Number(battleCancelMatch[1]);
      const result = await pool.query(
        `UPDATE nft_battles SET status = 'cancelled'
         WHERE id = $1 AND creator_id = $2 AND status = 'waiting'
         RETURNING id`,
        [battleId, String(user.id)]
      );
      if (!result.rowCount) return send(res, 409, { error: 'Нельзя отменить этот баттл' });
      return send(res, 200, { success: true });
    }

    const battleDetailMatch = url.pathname.match(/^\/api\/battles\/(\d+)$/);
    if (battleDetailMatch && req.method === 'GET') {
      const user = getTelegramUser(req);
      if (!user) return send(res, 401, { error: 'Ошибка авторизации Telegram' });
      const battleId = Number(battleDetailMatch[1]);
      const result = await pool.query(`
        SELECT b.*, c.username AS creator_username, c.first_name AS creator_first_name,
               o.username AS opponent_username, o.first_name AS opponent_first_name
        FROM nft_battles b
        JOIN users c ON c.telegram_id = b.creator_id
        LEFT JOIN users o ON o.telegram_id = b.opponent_id
        WHERE b.id = $1
      `, [battleId]);
      if (!result.rowCount) return send(res, 404, { error: 'Баттл не найден' });
      const row = result.rows[0];
      return send(res, 200, { battle: {
        id: Number(row.id), spins: Number(row.spins), status: row.status,
        creator_id: String(row.creator_id), opponent_id: row.opponent_id ? String(row.opponent_id) : null,
        creator_username: row.creator_username, creator_first_name: row.creator_first_name,
        opponent_username: row.opponent_username, opponent_first_name: row.opponent_first_name,
        creator_score: Number(row.creator_score || 0), opponent_score: Number(row.opponent_score || 0),
        winner_id: row.winner_id ? String(row.winner_id) : null,
        creator_result: row.creator_result || [], opponent_result: row.opponent_result || [],
        created_at: row.created_at, finished_at: row.finished_at
      }});
    }

    // Рулетка
    if (url.pathname === '/api/spin' && req.method === 'POST') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE',
          [String(user.id)]
        );

        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return send(res, 404, {
            error: 'Пользователь не найден'
          });
        }

        const account = result.rows[0];

        if (account.free_spins <= 0 && account.silver < 20) {
          await client.query('ROLLBACK');
          return send(res, 400, {
            error: 'Недостаточно серебра'
          });
        }

        if (account.free_spins > 0) {
          await client.query(`
            UPDATE users
            SET free_spins = free_spins - 1
            WHERE telegram_id = $1
          `, [String(user.id)]);
        } else {
          await client.query(`
            UPDATE users
            SET silver = silver - 20
            WHERE telegram_id = $1
          `, [String(user.id)]);
        }

        const chance = crypto.randomInt(100000);
        let prize = 'nothing';

        if (chance >= 99999) {
          prize = 'rare';
        } else if (chance >= 94999) {
          prize = 'unusual';
        } else if (chance >= 79999) {
          prize = 'ordinary';
        }

        const history = await client.query(`
          INSERT INTO spin_history (telegram_id, prize_type)
          VALUES ($1, $2)
          RETURNING id
        `, [String(user.id), prize]);

        let claimId = null;
        let winningGift = null;
        if (prize !== 'nothing') {
          const ordinaryGifts = [
            { id:'love_heart', name:'Love Heart', stars:15, emoji:'❤️', image_url:giftImage('loveheart') },
            { id:'teddy_bear', name:'Teddy Bear', stars:15, emoji:'🧸', image_url:giftImage('toybear') },
            { id:'gift_box', name:'Gift Box', stars:25, emoji:'🎁', image_url:giftImage('giftbox') },
            { id:'red_rose', name:'Red Rose', stars:25, emoji:'🌹', image_url:giftImage('redrose') },
            { id:'birthday_cake', name:'Birthday Cake', stars:50, emoji:'🎂', image_url:giftImage('birthdaycake') },
            { id:'bouquet', name:'Bouquet of Flowers', stars:50, emoji:'💐', image_url:giftImage('bouquetofflowers') },
            { id:'rocket', name:'Rocket', stars:50, emoji:'🚀', image_url:giftImage('rocket') },
            { id:'champagne', name:'Champagne Bottle', stars:50, emoji:'🍾', image_url:giftImage('champagne') },
            { id:'trophy', name:'Trophy', stars:100, emoji:'🏆', image_url:giftImage('trophy') },
            { id:'diamond_ring', name:'Diamond Ring', stars:100, emoji:'💍', image_url:giftImage('diamondring') },
            { id:'gem', name:'Gem', stars:100, emoji:'💎', image_url:giftImage('gem') }
          ];
          const giftPool = prize === 'ordinary'
            ? ordinaryGifts
            : PRODUCTS.filter(product => prize === 'unusual'
              ? Number(product.stars) >= 300 && Number(product.stars) <= 1000
              : Number(product.stars) >= 1000 && Number(product.stars) <= 10000);
          if (!giftPool.length) throw new Error('В каталоге нет подарков для выпавшей категории');
          const selected = giftPool[crypto.randomInt(giftPool.length)];
          winningGift = {
            id: selected.id,
            name: selected.name,
            stars: Number(selected.stars),
            emoji: selected.emoji || '🎁',
            image_url: selected.image_url || ''
          };
          const claim = await client.query(`
            INSERT INTO prize_claims
              (spin_history_id, telegram_id, prize_type, prize_name, prize_stars, prize_image_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
          `, [history.rows[0].id, String(user.id), prize, winningGift.name, winningGift.stars, winningGift.image_url]);
          claimId = claim.rows[0].id;
          await recordActivity(client, String(user.id), 'nft_collected', `claim:${claimId}`);
          await client.query(`
            INSERT INTO user_inventory
              (source_claim_id, telegram_id, prize_type, prize_name, prize_stars, prize_image_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (source_claim_id) DO NOTHING
          `, [claimId, String(user.id), prize, winningGift.name, winningGift.stars, winningGift.image_url]);
        }

        await awardXp(client, String(user.id), 10, 'spin', `spin:${history.rows[0].id}`);
        await recordActivity(client, String(user.id), 'spin_completed', `spin:${history.rows[0].id}`);

        const updated = await client.query(`
          SELECT silver, free_spins
          FROM users
          WHERE telegram_id = $1
        `, [String(user.id)]);

        await client.query('COMMIT');

        return send(res, 200, {
          result: prize === 'nothing' ? 'none' : prize,
          prize,
          silver: updated.rows[0].silver,
          free_spins: updated.rows[0].free_spins,
          claim_id: claimId,
          gift: winningGift
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Пополнение серебра
    if (url.pathname === '/api/topup' && req.method === 'POST') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      const body = await readBody(req);
      const stars = Number(body.stars);
      const recipient = body.recipient;

      if (
        !Number.isSafeInteger(stars) ||
        stars < 1 ||
        stars > 100000
      ) {
        return send(res, 400, {
          error: 'Укажи корректное количество звёзд'
        });
      }

      if (!['@traptrap4', '@RichGues'].includes(recipient)) {
        return send(res, 400, {
          error: 'Некорректный получатель'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        INSERT INTO topup_requests (telegram_id, stars, recipient)
        VALUES ($1, $2, $3)
        RETURNING id, stars, recipient, status
      `, [String(user.id), stars, recipient]);

      return send(res, 201, {
        message: 'Заявка создана',
        id: result.rows[0].id,
        request: result.rows[0]
      });
    }

    // Заявки на пополнение для администратора
    if (url.pathname === '/api/admin/topups' && req.method === 'GET') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const result = await pool.query(`
        SELECT
          r.id,
          r.telegram_id,
          u.username,
          u.first_name,
          r.stars,
          r.recipient,
          r.status,
          r.created_at
        FROM topup_requests r
        JOIN users u ON u.telegram_id = r.telegram_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
        LIMIT 100
      `);

      return send(res, 200, {
        requests: result.rows
      });
    }

    // Подтверждение / отклонение пополнения
    const decision = url.pathname.match(
      /^\/api\/admin\/topups\/(\d+)\/(approve|reject)$/
    );

    if (decision && req.method === 'POST') {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 403, {
          error: 'Доступ запрещён'
        });
      }

      const requestId = decision[1];
      const action = decision[2];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          'SELECT * FROM topup_requests WHERE id = $1 FOR UPDATE',
          [requestId]
        );

        if (
          !result.rowCount ||
          result.rows[0].status !== 'pending'
        ) {
          await client.query('ROLLBACK');
          return send(res, 409, {
            error: 'Заявка уже обработана или не найдена'
          });
        }

        const request = result.rows[0];

        if (action === 'approve') {
          await client.query(`
            UPDATE users
            SET silver = silver + $1
            WHERE telegram_id = $2
          `, [request.stars, request.telegram_id]);
        }

        await client.query(`
          UPDATE topup_requests
          SET status = $1, processed_at = NOW()
          WHERE id = $2
        `, [
          action === 'approve' ? 'approved' : 'rejected',
          requestId
        ]);

        await client.query('COMMIT');

        return send(res, 200, {
          success: true,
          message: action === 'approve'
            ? 'Серебро начислено'
            : 'Заявка отклонена'
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Главная страница
    if (url.pathname === '/' && req.method === 'GET') {
      return fs.readFile(
        path.join(__dirname, 'index.html'),
        (err, content) => {
          if (err) {
            res.writeHead(500);
            return res.end('Ошибка загрузки сайта');
          }

          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          });

          res.end(content);
        }
      );
    }

    return send(res, 404, {
      error: 'Страница не найдена'
    });

  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      send(res, 500, {
        error: 'Внутренняя ошибка сервера'
      });
    }
  }
});

initDatabase()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`GiftsDrop server started on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Ошибка запуска базы данных:', error);
    process.exit(1);
  });
