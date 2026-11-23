
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
{ id: 'ufc_strikes', name: 'UFC Strikes', stars: toStars(23), discount: 5, emoji: '🥊', image_url: giftImage('uf strikes') },
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
      ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;

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
      prize_type TEXT NOT NULL CHECK (prize_type IN ('ordinary', 'rare')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS bot_payments (
      charge_id TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      stars INTEGER NOT NULL,
      spins INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_legacy_migrations (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      legacy_spins INTEGER NOT NULL,
      legacy_referrals INTEGER NOT NULL,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
      stars INTEGER NOT NULL CHECK (stars BETWEEN 300 AND 5000),
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

    CREATE INDEX IF NOT EXISTS gift_orders_user_idx
      ON gift_orders(telegram_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS gift_orders_status_idx
      ON gift_orders(status, created_at DESC);
  `);
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
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const inserted = await client.query(`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_id) DO NOTHING
      RETURNING telegram_id
    `, [
      telegramId,
      user.username || null,
      user.first_name || null
    ]);

    await client.query(`
      UPDATE users
      SET username = $1, first_name = $2
      WHERE telegram_id = $3
    `, [
      user.username || null,
      user.first_name || null,
      telegramId
    ]);

    if (
      inserted.rowCount === 1 &&
      referralId &&
      referralId !== telegramId
    ) {
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

        const count = Number(referrer.rows[0].referral_count);

        if (count % 10 === 0) {
          await client.query(`
            UPDATE users
            SET free_spins = free_spins + 3
            WHERE telegram_id = $1
          `, [referralId]);
        }
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
        stars < 300 ||
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
        stars < 300 ||
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
        const prize = roll >= 99990 ? 'rare' : (roll >= 90000 ? 'ordinary' : 'nothing');
        const history = await client.query(
          'INSERT INTO spin_history (telegram_id, prize_type) VALUES ($1, $2) RETURNING id',
          [telegramId, prize]
        );
        let claimId = null;
        if (prize !== 'nothing') {
          const claim = await client.query(
            'INSERT INTO prize_claims (spin_history_id, telegram_id, prize_type) VALUES ($1, $2, $3) RETURNING id',
            [history.rows[0].id, telegramId, prize]
          );
          claimId = claim.rows[0].id;
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

    // Аккаунт
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = getTelegramUser(req);

      if (!user) {
        return send(res, 401, {
          error: 'Ошибка авторизации Telegram'
        });
      }

      await ensureUser(user, req);

      const result = await pool.query(`
        SELECT silver, free_spins, referral_count
        FROM users
        WHERE telegram_id = $1
      `, [String(user.id)]);

      return send(res, 200, result.rows[0]);
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

        if (chance >= 99990) {
          prize = 'rare';
        } else if (chance >= 90000) {
          prize = 'ordinary';
        }

        const history = await client.query(`
          INSERT INTO spin_history (telegram_id, prize_type)
          VALUES ($1, $2)
          RETURNING id
        `, [String(user.id), prize]);

        let claimId = null;
        if (prize !== 'nothing') {
          const claim = await client.query(`
            INSERT INTO prize_claims (spin_history_id, telegram_id, prize_type)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [history.rows[0].id, String(user.id), prize]);
          claimId = claim.rows[0].id;
        }

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
          claim_id: claimId
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
            'Content-Type': 'text/html; charset=utf-8'
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