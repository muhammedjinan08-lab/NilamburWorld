/**
 * economy.js - cash, shopping and jobs.
 *
 * Everything in Nilambur is paid for in cash, and the only way to get cash is to work: the Jobs board
 * offers courier runs, fish deliveries, newspaper rounds, porter work, passenger runs and errands out to
 * the teak plots and the Adyanpara spring. Completing a quest pays an exploration bounty too.
 *
 * Every store has a real billing counter (an "E" spot, see shopSpot()): its own catalogue with prices
 * and limited stock that slowly restocks, a cart, and a bill paid from the cash in your pocket. What
 * you buy goes into your bag (carried in your hand) and can be used - eat food, drink tea, wear the
 * clothes you bought, take the medicine, or hand your raw fish to a restaurant to be cooked. At the fish
 * market the fish on the ice really go when you buy them.
 *
 * Wallet, bag and job progress are saved per browser (localStorage) - not shared with other players.
 * Depends on interiors.js (addSpot, ROOMS, sub, chime) and main.js globals at runtime (state, scene,
 * playerRig, triggerLandmarkPopup, applyPlayerAppearance, groundHeight, LANDMARKS).
 */

// ======================================================================================================
// Wallet + bag
// ======================================================================================================
const ECON_LS = 'nw_econ_v1';
const econ = (function () {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(ECON_LS) || 'null'); } catch (e) { /* private mode */ }
  if (!d || typeof d.cash !== 'number' || !Array.isArray(d.bag)) d = { cash: 0, bag: [], earned: 0, jobsDone: 0 };
  d.cash = Math.max(0, Math.round(d.cash));
  d.bag = d.bag.filter(b => b && b.id && b.qty > 0);
  return d;
})();
function saveEcon() {
  try { localStorage.setItem(ECON_LS, JSON.stringify(econ)); } catch (e) { /* private mode */ }
  refreshEconUI();
}
const fmtRs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

function earnCash(n) {
  n = Math.round(n);
  econ.cash += n; econ.earned = (econ.earned || 0) + n;
  saveEcon(); flashWallet('+' + fmtRs(n), true);
  if (typeof chime === 'function') chime([660, 990, 1320], 0.6);
}
function spendCash(n) {
  n = Math.round(n);
  if (econ.cash < n) return false;
  econ.cash -= n;
  saveEcon();
  if (n > 0) flashWallet('-' + fmtRs(n), false);
  return true;
}
function bagAdd(it, qty) {
  const b = econ.bag.find(x => x.id === it.id);
  if (b) b.qty += qty;
  else econ.bag.push({ id: it.id, name: it.name, emoji: it.emoji, kind: it.kind, unit: it.unit || '', outfit: it.outfit || null, qty: qty });
}
function bagCount(kind) { return econ.bag.reduce((s, b) => s + (!kind || b.kind === kind ? b.qty : 0), 0); }
function bagTake(kind, n) {
  // Removes n units of a kind (oldest first); returns the names taken
  const got = [];
  for (const b of econ.bag) {
    while (b.kind === kind && b.qty > 0 && got.length < n) { b.qty--; got.push(b.name); }
  }
  econ.bag = econ.bag.filter(b => b.qty > 0);
  return got;
}

// ======================================================================================================
// Catalogues - one per kind of store. [id, emoji, name, price, kind, stock, extra]
// kinds: food/drink/med (usable), outfit (wear), fish (raw - cook it at a restaurant), item, ticket,
// big (delivered to your home), svc (a service, done on the spot - nothing goes into the bag)
// ======================================================================================================
function it(id, emoji, name, price, kind, stock, x) { return Object.assign({ id: id, emoji: emoji, name: name, price: price, kind: kind, stock: stock }, x || {}); }
const CATALOG = {
  veg: { title: 'Vegetables & fruits', items: [
    it('tomato', '🍅', 'Tomatoes, 1 kg', 40, 'item', 20), it('onion', '🧅', 'Small onions, 1 kg', 60, 'item', 20),
    it('potato', '🥔', 'Potatoes, 1 kg', 45, 'item', 20), it('carrot', '🥕', 'Ooty carrots, 500 g', 35, 'item', 15),
    it('drumstick', '🥢', 'Drumsticks, 3 pcs', 30, 'item', 12), it('curryleaf', '🌿', 'Curry leaves, bunch', 10, 'item', 30),
    it('nendran', '🍌', 'Nendran bananas, 1 kg', 70, 'food', 15), it('mango', '🥭', 'Mangoes, 1 kg', 120, 'food', 12),
    it('pineapple', '🍍', 'Vazhakulam pineapple', 60, 'food', 8), it('tendercoco', '🥥', 'Tender coconut', 50, 'drink', 10)] },
  spice: { title: 'Spices of the Nilambur hills', items: [
    it('pepper', '⚫', 'Malabar black pepper, 250 g', 180, 'item', 12), it('cardamom', '🟢', 'Cardamom, 100 g', 280, 'item', 10),
    it('cinnamon', '🪵', 'Cinnamon, 100 g', 90, 'item', 10), it('clove', '🌰', 'Cloves, 100 g', 140, 'item', 10),
    it('turmeric', '🟡', 'Turmeric powder, 200 g', 60, 'item', 15), it('chillipd', '🌶️', 'Kashmiri chilli powder, 250 g', 75, 'item', 15),
    it('coffee', '☕', 'Wayanad coffee powder, 250 g', 150, 'item', 10), it('honey', '🍯', 'Forest honey, 500 g', 320, 'food', 6)] },
  salon: { title: 'Salon services', items: [
    it('shave', '🪒', 'Shave', 60, 'svc', 99, { msg: 'A clean shave with hot towel and aftershave. "Smooth, like a new man!"' }),
    it('beard', '🧔', 'Beard trim & shape', 70, 'svc', 99, { msg: 'Beard trimmed and lined up sharp.' }),
    it('massage', '💆', 'Head massage with coconut oil', 100, 'svc', 99, { msg: 'Ten minutes of Kerala head massage - pure bliss.' }),
    it('hairoil', '🧴', 'Hair oil, 200 ml', 90, 'item', 10)] },
  textile: { title: 'Textiles & readymades', items: [
    it('o_mundu', '👔', 'Mundu & shirt set', 850, 'outfit', 6, { outfit: 'mundu_shirt' }),
    it('o_jubba', '🥻', 'Jubba & mundu', 1200, 'outfit', 5, { outfit: 'jubba_mundu' }),
    it('o_kasavum', '✨', 'Kasavu mundu & angavastram', 1500, 'outfit', 4, { outfit: 'kasavu_mundu' }),
    it('o_saree', '🥻', 'Kasavu saree', 2400, 'outfit', 4, { outfit: 'kasavu_saree' }),
    it('o_churidar', '👗', 'Churidar set', 1100, 'outfit', 5, { outfit: 'churidar' }),
    it('o_kurta', '👚', 'Kurta & leggings', 900, 'outfit', 5, { outfit: 'kurta_leggings' }),
    it('o_formal', '👔', 'Shirt & trousers', 1600, 'outfit', 5, { outfit: 'shirt_trousers' }),
    it('o_jeans', '👕', 'T-shirt & jeans', 1300, 'outfit', 6, { outfit: 'tshirt_jeans' }),
    it('o_shorts', '🩳', 'T-shirt & shorts', 700, 'outfit', 6, { outfit: 'shorts_tee' }),
    it('towel', '🧣', 'Thorthu (cotton towel)', 80, 'item', 20)] },
  tailor: { title: 'Tailoring', items: [
    it('stitchshirt', '🧵', 'Shirt stitching', 450, 'svc', 99, { msg: 'Measurements taken - chest 38, sleeve 24. Ready the day after tomorrow.' }),
    it('stitchblouse', '🪡', 'Blouse stitching', 350, 'svc', 99, { msg: 'Blouse measured and cut - ready by Friday.' }),
    it('alter', '✂️', 'Alteration', 100, 'svc', 99, { msg: 'Hemmed and taken in - done while you waited.' })] },
  gold: { title: 'Gold & silver', items: [
    it('anklet', '🪙', 'Silver anklets (kolusu)', 2400, 'item', 4), it('goldcoin', '🟡', 'Gold coin, 1 g', 7800, 'item', 5),
    it('ring', '💍', 'Gold ring, 2 g', 15500, 'item', 3), it('jimikki', '✨', 'Jimikki earrings, 4 g', 31000, 'item', 2),
    it('chain', '📿', 'Gold chain, 8 g', 62000, 'item', 2), it('necklace', '👑', 'Temple necklace, 32 g', 215000, 'item', 1)] },
  bakery: { title: 'Bakery', items: [
    it('puff', '🥐', 'Chicken puff', 25, 'food', 20), it('eggpuff', '🥚', 'Egg puff', 20, 'food', 20),
    it('creambun', '🍞', 'Cream bun', 20, 'food', 15), it('unniyappam', '🟤', 'Unniyappam, 6 pcs', 60, 'food', 10),
    it('halwa', '🟥', 'Kozhikode halwa, 250 g', 120, 'food', 8), it('chips', '🟨', 'Banana chips, 250 g', 90, 'food', 12),
    it('plumcake', '🎂', 'Plum cake, 500 g', 180, 'food', 6), it('lime', '🍋', 'Fresh lime soda', 30, 'drink', 20)] },
  teadepot: { title: 'Tea depot', items: [
    it('dusttea', '🍵', 'Kanan Devan dust tea, 500 g', 260, 'item', 12), it('greentea', '🍃', 'Green tea, 100 g', 180, 'item', 8),
    it('cardtea', '🫖', 'Cardamom tea, 250 g', 190, 'item', 8), it('coffee2', '☕', 'Filter coffee powder, 250 g', 150, 'item', 10)] },
  chaya: { title: 'Tea stall', items: [
    it('chaya', '☕', 'Chaya (milk tea)', 12, 'drink', 40), it('kattan', '🍵', 'Kattan chaya (black tea)', 10, 'drink', 40),
    it('sulaimani', '🍋', 'Sulaimani', 15, 'drink', 30), it('parippuvada', '🟠', 'Parippuvada', 10, 'food', 25),
    it('pazhampori', '🍌', 'Pazhampori', 12, 'food', 25), it('bonda', '🟤', 'Bonda', 10, 'food', 20)] },
  provisions: { title: 'Provisions', items: [
    it('rice', '🍚', 'Matta rice, 5 kg', 280, 'item', 10), it('cocooil', '🥥', 'Coconut oil, 1 L', 210, 'item', 10),
    it('sugar', '🧂', 'Sugar, 1 kg', 48, 'item', 15), it('rava', '🌾', 'Rava, 500 g', 35, 'item', 15),
    it('salt', '🧂', 'Salt, 1 kg', 22, 'item', 15), it('jaggery', '🟫', 'Jaggery, 500 g', 45, 'food', 10),
    it('chips2', '🟨', 'Banana chips, 250 g', 90, 'food', 10)] },
  supermarket: { title: 'Supermarket', items: [
    it('rice2', '🍚', 'Matta rice, 5 kg', 285, 'item', 10), it('batter', '🥣', 'Dosa batter, 1 kg', 70, 'item', 10),
    it('milk', '🥛', 'Milma milk, 500 ml', 28, 'drink', 20), it('bread', '🍞', 'Bread', 45, 'food', 12),
    it('biscuit', '🍪', 'Biscuits', 30, 'food', 25), it('eggs', '🥚', 'Eggs, 6', 42, 'item', 12),
    it('soap', '🧼', 'Soap', 45, 'item', 20), it('toothpaste', '🪥', 'Toothpaste', 95, 'item', 12),
    it('water', '💧', 'Water bottle, 1 L', 20, 'drink', 30)] },
  pharmacy: { title: 'Pharmacy', items: [
    it('paracetamol', '💊', 'Paracetamol 650, strip', 30, 'med', 20), it('ors', '🧃', 'ORS sachets', 25, 'med', 20),
    it('cough', '🍯', 'Cough syrup', 110, 'med', 10), it('balm', '🟢', 'Pain balm', 45, 'med', 15),
    it('bandage', '🩹', 'Bandage roll', 40, 'item', 15), it('vitc', '🍊', 'Vitamin C tablets', 95, 'med', 10),
    it('sanitizer', '🧴', 'Hand sanitizer', 70, 'item', 12)] },
  hardware: { title: 'Hardware', items: [
    it('hammer', '🔨', 'Claw hammer', 350, 'item', 6), it('nails', '📌', 'Nails, 1 kg', 120, 'item', 10),
    it('polish', '🪵', 'Teak wood polish, 1 L', 420, 'item', 6), it('screwdriver', '🪛', 'Screwdriver set', 280, 'item', 6),
    it('paint', '🎨', 'Paint, 1 L', 390, 'item', 8), it('padlock', '🔒', 'Padlock', 180, 'item', 8),
    it('torch', '🔦', 'Torch', 250, 'item', 8), it('pipe', '🧰', 'PVC pipe, 3 m', 260, 'big', 10)] },
  mobile: { title: 'Mobiles & accessories', items: [
    it('recharge', '📶', 'Prepaid recharge, 28 days', 299, 'svc', 99, { msg: 'Recharge done - unlimited calls and 2 GB/day for 28 days.' }),
    it('guard', '🛡️', 'Screen guard (fitted)', 199, 'item', 15), it('cover', '📱', 'Back cover', 249, 'item', 15),
    it('earphones', '🎧', 'Earphones', 499, 'item', 10), it('charger', '🔌', 'Fast charger', 650, 'item', 8),
    it('powerbank', '🔋', 'Power bank', 1299, 'item', 6), it('phone', '📱', '5G phone, 50 MP camera', 17999, 'item', 4),
    it('budgetph', '📱', 'Budget smartphone', 8999, 'item', 4)] },
  laptops: { title: 'Laptops & computers', items: [
    it('mouse', '🖱️', 'Wireless mouse', 499, 'item', 10), it('pendrive', '💾', 'Pen drive, 64 GB', 550, 'item', 10),
    it('router', '📡', 'Wi-Fi router', 1800, 'item', 5), it('headphones', '🎧', 'Headphones', 1999, 'item', 5),
    it('laptop', '💻', 'Laptop, 16 GB RAM', 58990, 'item', 3), it('camera', '📷', 'Mirrorless camera kit', 64500, 'item', 2)] },
  electronics: { title: 'Electronics & appliances', items: [
    it('bulb', '💡', 'LED bulb', 120, 'item', 20), it('extboard', '🔌', 'Extension board', 450, 'item', 8),
    it('ironbox', '🧺', 'Iron box', 950, 'item', 5), it('fan', '🌀', 'Ceiling fan', 2450, 'big', 5),
    it('mixer', '🥤', 'Mixer grinder', 3600, 'big', 4), it('ricecooker', '🍚', 'Rice cooker', 2800, 'big', 4),
    it('tv', '📺', '43-inch 4K smart TV', 28990, 'big', 3)] },
  xerox: { title: 'Xerox & DTP', items: [
    it('copies', '📄', 'Photocopy, 20 pages', 40, 'svc', 99, { msg: '20 crisp copies, stapled.' }),
    it('printout', '🖨️', 'Colour printout, 5 pages', 50, 'item', 99), it('binding', '📘', 'Spiral binding', 50, 'svc', 99, { msg: 'Your project report is spiral-bound with a clear cover.' }),
    it('photos', '🪪', 'Passport photos, 8', 100, 'item', 99), it('lamination', '🪪', 'ID card lamination', 20, 'svc', 99, { msg: 'Laminated - waterproof for the monsoon.' })] },
  uniform: { title: 'School supplies', items: [
    it('schoolbag', '🎒', 'Waterproof school bag', 850, 'item', 8), it('uniformset', '👕', 'Uniform set', 500, 'item', 10),
    it('bottle', '🍶', 'Water bottle', 180, 'item', 12), it('lunchbox', '🍱', 'Lunch box', 250, 'item', 10),
    it('umbrella', '☂️', 'Umbrella (monsoon special)', 450, 'item', 10)] },
  books: { title: 'Books & stationery', items: [
    it('b_randam', '📕', '"Randamoozham" - M.T. Vasudevan Nair', 399, 'item', 4), it('b_aadu', '📗', '"Aadujeevitham" - Benyamin', 250, 'item', 4),
    it('b_khasak', '📘', '"Khasakkinte Ithihasam" - O.V. Vijayan', 299, 'item', 4), it('notebook', '📓', 'Long notebook, 200 pages', 60, 'item', 20),
    it('pens', '🖊️', 'Pens, pack of 5', 50, 'item', 20), it('paper', '📰', 'Malayalam newspaper', 8, 'item', 30)] },
  lodge: { title: 'Lodge reception', items: [
    it('room', '🛏️', 'A/C double room, 1 night', 1400, 'svc', 6, { msg: 'Room 204, second floor - here is your key. Breakfast is served 7 to 10.' }),
    it('nonac', '🛏️', 'Non-A/C room, 1 night', 800, 'svc', 6, { msg: 'Room 108 - fan, hot water and a view of the hills.' }),
    it('breakfast', '🥞', 'Breakfast - appam & stew', 80, 'food', 20)] },
  restaurant: { title: 'Restaurant', items: [
    it('biriyani', '🍛', 'Malabar chicken biriyani', 160, 'food', 20), it('sadya', '🍃', 'Kerala sadya on a banana leaf', 140, 'food', 15),
    it('porotta', '🥘', 'Porotta & beef fry', 120, 'food', 20), it('meals', '🍚', 'Fish curry meals', 90, 'food', 20),
    it('appam', '🥞', 'Appam & stew', 80, 'food', 15), it('limejuice', '🍋', 'Lime juice', 25, 'drink', 30),
    it('cookfish', '🔥', 'Cook my fish (bring raw fish in your bag)', 80, 'svc', 99, { needs: 'fish', msg: 'The cook marinates your fish in chilli and turmeric and fries it in coconut oil.' })] },
  furniture: { title: 'Nilambur teak furniture', items: [
    it('frame', '🖼️', 'Teak photo frame', 350, 'item', 10), it('pchair', '🪑', 'Plastic chair', 450, 'big', 10),
    it('tchair', '🪑', 'Teak chair', 6500, 'big', 4), it('cot', '🛏️', 'Teak cot', 42000, 'big', 2),
    it('dining', '🍽️', 'Teak dining table, 6 seats', 38000, 'big', 2), it('oonjal', '🪢', 'Carved teak oonjal (swing)', 48000, 'big', 1)] },
  optical: { title: 'Opticals', items: [
    it('eyetest', '👁️', 'Eye test', 0, 'svc', 99, { msg: 'Read the chart... "E, F P, T O Z" - perfect 6/6 vision!' }),
    it('cleaner', '🧽', 'Lens cleaning kit', 120, 'item', 10), it('readers', '👓', 'Reading glasses', 450, 'item', 6),
    it('sunglasses', '🕶️', 'Anti-glare sunglasses', 799, 'item', 6), it('specs', '👓', 'Spectacles with frame', 1200, 'item', 4)] },
  general: { title: 'General store', items: [
    it('water2', '💧', 'Water bottle, 1 L', 20, 'drink', 20), it('biscuit2', '🍪', 'Biscuits', 30, 'food', 20),
    it('soap2', '🧼', 'Soap', 45, 'item', 15), it('matches', '🔥', 'Matchbox', 2, 'item', 40),
    it('candles', '🕯️', 'Candles, 6', 30, 'item', 15), it('umbrella2', '☂️', 'Umbrella', 450, 'item', 5)] },
  hospital: { title: 'OP counter', items: [
    it('op', '🎫', 'OP ticket - General Medicine', 10, 'svc', 99, { msg: 'Token no. 42 - Dr. Nair, room 2. Please wait on the bench.' }),
    it('optest', '🧪', 'Blood test', 150, 'svc', 99, { msg: 'Sample taken - results by 4 pm at the lab window.' })] },
  post: { title: 'Post office counter', items: [
    it('stamp', '📮', 'Postage stamp', 5, 'item', 99), it('postcard', '💌', 'Postcard', 1, 'item', 99),
    it('speedpost', '✉️', 'Speed Post letter to Kozhikode', 41, 'svc', 99, { msg: 'Posted - it will reach tomorrow. Tracking no. EK4471IN.' }),
    it('parcel', '📦', 'Parcel to Chennai, 1 kg', 180, 'svc', 99, { msg: 'Weighed, sealed and sent - 3 to 4 days.' })] },
  kseb: { title: 'KSEB cash counter', items: [
    it('bill', '💡', 'Pay the electricity bill (212 units)', 1186, 'svc', 99, { msg: 'Bill paid - consumer no. 1145327. "Pay online next time!"' })] },
  theatre: { title: 'Sreedhar Theatre', items: [
    it('balcony', '🎟️', 'Balcony ticket', 150, 'svc', 99, { msg: '"Manjummel Boys" - you watch the whole film from the balcony. Whistles at the interval!' }),
    it('firstcl', '🎟️', 'First class ticket', 110, 'svc', 99, { msg: '"Aavesham" - housefull, and the crowd dances in the aisles.' }),
    it('popcorn', '🍿', 'Popcorn', 120, 'food', 30), it('softdrink', '🥤', 'Soft drink', 60, 'drink', 30)] },
  busdepot: { title: 'KSRTC reservation', items: [
    it('t_kozhikode', '🚌', 'Ticket to Kozhikode', 92, 'ticket', 40), it('t_ooty', '🚌', 'Ticket to Ooty via Nadukani', 145, 'ticket', 30),
    it('t_malappuram', '🚌', 'Ticket to Malappuram', 45, 'ticket', 40)] },
  museum: { title: 'Teak Museum ticket counter', items: [
    it('m_adult', '🎟️', 'Entry ticket', 50, 'ticket', 99), it('m_guide', '🧭', 'Guided tour', 100, 'svc', 99, { msg: 'The guide walks you through 150 years of teak history - and the 480-year-old teak log.' }),
    it('m_book', '📗', 'Teak heritage booklet', 60, 'item', 20)] },
  train: { title: 'Booking office', items: [
    it('t_shoranur', '🎫', 'Nilambur Road - Shoranur, 2nd class', 25, 'ticket', 99), it('t_ernakulam', '🎫', 'Nilambur Road - Ernakulam, 2nd class', 65, 'ticket', 99),
    it('t_platform', '🎫', 'Platform ticket', 10, 'ticket', 99)] },
  fuel: { title: 'Fuel station', items: [
    it('petrol', '⛽', 'Petrol, 1 litre', 105, 'svc', 99, { msg: 'Tank topped up. Free air check too.' }),
    it('diesel', '⛽', 'Diesel, 1 litre', 94, 'svc', 99, { msg: 'Diesel filled.' }),
    it('engineoil', '🛢️', 'Engine oil, 1 L', 450, 'item', 10), it('water3', '💧', 'Water bottle, 1 L', 20, 'drink', 20)] },
  fish: { title: 'Fresh fish stall', items: [
    it('mathi', '🐟', 'Mathi (sardines), 1 kg', 180, 'fish', 14), it('ayala', '🐟', 'Ayala (mackerel), 1 kg', 260, 'fish', 10),
    it('karimeen', '🐠', 'Karimeen (pearl spot), 1 kg', 550, 'fish', 8), it('neymeen', '🐟', 'Neymeen (seer fish), 1 kg', 900, 'fish', 4),
    it('choora', '🐟', 'Choora (tuna), 1 kg', 320, 'fish', 5), it('chemmeen', '🦐', 'Chemmeen (prawns), 500 g', 240, 'fish', 10)] }
};

// ======================================================================================================
// Shops: one instance per counter, with its own stock (restocks one unit a minute)
// ======================================================================================================
const SHOPS = [];
function makeShop(key, name) {
  const cat = CATALOG[key];
  const shop = { key: key, name: name || cat.title, title: cat.title, items: cat.items.map(i => Object.assign({}, i, { left: i.stock })), listeners: [] };
  SHOPS.push(shop);
  return shop;
}
setInterval(() => {
  for (const s of SHOPS) {
    let ch = false;
    for (const i of s.items) if (i.left < i.stock) { i.left++; ch = true; }
    if (ch) s.listeners.forEach(f => f(s));
  }
  if (_shopOpen) renderShop();
}, 60000);

// Buying spot at a counter. Returns the shop so a display (the fish on the ice) can follow its stock.
function shopSpot(T, lx, lz, icon, label, key, r, name) {
  const shop = makeShop(key, name);
  addSpot(T, lx, 0, lz, icon, label, () => { openShop(shop); return null; }, r || 1.8);
  return shop;
}

// ======================================================================================================
// UI: shop counter, bag, jobs board, wallet chip, active-job banner
// ======================================================================================================
let _shopOpen = null, _cart = {}, _shopMsg = '', _bagOpen = false, _jobsOpen = false;
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function econModalOpen() { return !!(_shopOpen || _bagOpen || _jobsOpen || document.querySelector('#garage-modal.open, #adchoice-modal.open') || (typeof ADS !== 'undefined' && ADS.playing)); }
function closeEconModals() {
  _shopOpen = null; _bagOpen = false; _jobsOpen = false;
  ['shop-modal', 'bag-modal', 'jobs-modal', 'garage-modal'].forEach(id => { const m = $(id); if (m) m.classList.remove('open'); });
}
function openModal(id) {
  closeEconModals();
  if (typeof keyState !== 'undefined') for (const k in keyState) keyState[k] = false;   // stop walking
  $(id).classList.add('open');
}

function openShop(shop) {
  openModal('shop-modal');
  _shopOpen = shop; _cart = {}; _shopMsg = '';
  renderShop();
}
function cartTotal() { let t = 0; for (const id in _cart) { const i = _shopOpen.items.find(x => x.id === id); if (i) t += i.price * _cart[id]; } return t; }
function renderShop() {
  const s = _shopOpen; if (!s) return;
  $('shop-title').textContent = s.name;
  $('shop-sub').textContent = s.title;
  const list = $('shop-list'); list.textContent = '';
  for (const i of s.items) {
    const row = el('div', 'shop-row' + (i.left <= 0 ? ' soldout' : ''));
    row.appendChild(el('span', 'shop-emoji', i.emoji));
    const nm = el('div', 'shop-name', i.name);
    const meta = i.kind === 'svc' ? 'service' : (i.left > 0 ? i.left + ' left' : 'sold out - restocking');
    nm.appendChild(el('small', '', meta + (i.kind === 'big' ? ' · home delivery' : '')));
    row.appendChild(nm);
    row.appendChild(el('span', 'shop-price', i.price ? fmtRs(i.price) : 'free'));
    if (i.left <= 0 && i.kind !== 'svc' && typeof ADS !== 'undefined' && ADS.enabled) {   // sold out: restock it now by watching an ad (ads.js)
      const r = el('button', 'btn-teleport btn-use btn-ad', '▶ Restock'); r.type = 'button'; r.title = 'Watch a short ad to restock this item now';
      r.onclick = () => restockWithAd(s, i, renderShop);
      row.appendChild(r);
      list.appendChild(row);
      continue;
    }
    const q = _cart[i.id] || 0;
    const step = el('div', 'shop-step');
    const minus = el('button', 'btn-step', '−'); minus.type = 'button'; minus.disabled = q <= 0;
    minus.onclick = () => { _cart[i.id] = Math.max(0, q - 1); _shopMsg = ''; renderShop(); };
    const plus = el('button', 'btn-step', '+'); plus.type = 'button'; plus.disabled = q >= i.left;
    plus.onclick = () => { _cart[i.id] = q + 1; _shopMsg = ''; renderShop(); };
    plus.dataset.id = i.id;
    step.appendChild(minus); step.appendChild(el('span', 'shop-qty', String(q))); step.appendChild(plus);
    row.appendChild(step);
    list.appendChild(row);
  }
  const total = cartTotal();
  $('shop-cash').textContent = 'Cash in hand: ' + fmtRs(econ.cash);
  $('shop-total').textContent = 'Total: ' + fmtRs(total);
  const pay = $('shop-pay');
  const n = Object.values(_cart).reduce((a, b) => a + b, 0);
  pay.disabled = n === 0;
  pay.textContent = n === 0 ? 'Pay' : 'Pay ' + fmtRs(total) + ' cash';
  const msg = $('shop-msg');
  msg.textContent = _shopMsg || (total > econ.cash ? 'Not enough cash. Earn some from 💼 Jobs first.' : '');
  msg.className = 'shop-msg' + (total > econ.cash && !_shopMsg ? ' warn' : '');
}
function payShop() {
  const s = _shopOpen; if (!s) return;
  const total = cartTotal();
  const lines = s.items.filter(i => _cart[i.id] > 0);
  if (!lines.length) return;
  if (total > econ.cash) { _shopMsg = 'Not enough cash - you have ' + fmtRs(econ.cash) + ', the bill is ' + fmtRs(total) + '. Take a job from 💼 Jobs to earn more.'; renderShop(); return; }
  for (const i of lines) {
    if (i.needs && bagCount(i.needs) < _cart[i.id]) { _shopMsg = 'You need raw fish in your bag for that - buy some at the fish market first.'; renderShop(); return; }
    if (_cart[i.id] > i.left) { _shopMsg = i.name + ': only ' + i.left + ' left.'; renderShop(); return; }
  }
  spendCash(total);
  const notes = [];
  for (const i of lines) {
    const q = _cart[i.id];
    if (i.kind !== 'svc') i.left -= q;
    if (i.needs === 'fish') {
      const fish = bagTake('fish', q);
      fish.forEach(f => { const sp = f.split(' (')[0].split(',')[0]; bagAdd({ id: 'fried_' + sp.toLowerCase(), emoji: '🍽️', name: 'Fried ' + sp + ' (your catch)', kind: 'food' }, 1); });
      notes.push(i.msg);
    } else if (i.kind === 'svc') notes.push(i.msg);
    else bagAdd(i, q);
  }
  s.listeners.forEach(f => f(s));
  saveEcon();
  if (typeof chime === 'function') chime([988, 1319], 0.35);
  const bought = lines.filter(i => i.kind !== 'svc' && !i.needs).map(i => _cart[i.id] + ' × ' + i.name);
  _cart = {};
  _shopMsg = 'Paid ' + fmtRs(total) + '. ' + (bought.length ? 'In your bag: ' + bought.join(', ') + '. ' : '') + notes.join(' ') +
    (lines.some(i => i.kind === 'big') ? ' Big items will be delivered to your home.' : '');
  renderShop();
}

// ---------- Bag ----------
const USE_VERB = { food: 'Eat', drink: 'Drink', med: 'Take', outfit: 'Wear' };
function openBag() { openModal('bag-modal'); _bagOpen = true; renderBag(); }
function renderBag(note) {
  $('bag-cash').textContent = 'Cash in hand: ' + fmtRs(econ.cash) + ' · earned so far ' + fmtRs(econ.earned || 0);
  const list = $('bag-list'); list.textContent = '';
  if (!econ.bag.length) list.appendChild(el('div', 'friend-empty', 'Your bag is empty. Buy things at any shop counter (walk in and press E).'));
  for (const b of econ.bag) {
    const row = el('div', 'shop-row');
    row.appendChild(el('span', 'shop-emoji', b.emoji));
    const hint = b.kind === 'fish' ? 'raw - get it cooked at a restaurant' : b.kind === 'big' ? 'delivered to your home' : b.kind === 'ticket' ? 'ticket' : '';
    const nm = el('div', 'shop-name', b.name); if (hint) nm.appendChild(el('small', '', hint));
    row.appendChild(nm);
    row.appendChild(el('span', 'shop-qty', '× ' + b.qty));
    if (USE_VERB[b.kind]) {
      const u = el('button', 'btn-teleport btn-use', USE_VERB[b.kind]); u.type = 'button';
      u.onclick = () => useItem(b);
      row.appendChild(u);
    }
    list.appendChild(row);
  }
  $('bag-msg').textContent = note || '';
}
function useItem(b) {
  let note = '';
  if (b.kind === 'outfit') {
    const partial = { outfit: b.outfit };
    if (window.NW && NW.setAppearance) NW.setAppearance(partial);
    else if (typeof applyPlayerAppearance === 'function') applyPlayerAppearance(Object.assign({}, window.playerAppearance, partial));
    note = 'You change into your new ' + b.name.toLowerCase() + '. It stays in your bag - wear it any time.';
  } else {
    b.qty--;
    econ.bag = econ.bag.filter(x => x.qty > 0);
    note = b.kind === 'food' ? 'You eat the ' + b.name.toLowerCase() + '. Delicious!'
      : b.kind === 'drink' ? 'You drink the ' + b.name.toLowerCase() + '. Refreshing!'
      : 'You take the ' + b.name.toLowerCase() + '. Feeling better already.';
  }
  saveEcon();
  renderBag(note);
}

// ---------- Wallet chip + flash ----------
function refreshEconUI() {
  const c = $('wallet-amt'); if (c) c.textContent = fmtRs(econ.cash);
  const n = $('bag-count'); if (n) { const k = bagCount(); n.textContent = k ? String(k) : ''; n.style.display = k ? '' : 'none'; }
  const jb = $('btn-jobs'); if (jb) jb.classList.toggle('pulse', econ.cash < 20 && !JOBS.active);
  if (_bagOpen) renderBag($('bag-msg').textContent);
  updateCarry();
}
let _flashT = null;
function flashWallet(txt, good) {
  const f = $('wallet-flash'); if (!f) return;
  f.textContent = txt; f.className = 'wallet-flash show ' + (good ? 'good' : 'bad');
  clearTimeout(_flashT); _flashT = setTimeout(() => { f.className = 'wallet-flash'; }, 1600);
}

// ---------- Carried bag in the player's right hand ----------
let _carry = null;
function updateCarry() {
  if (typeof playerRig === 'undefined' || !playerRig || !playerRig.armR) return;
  if (!_carry) {
    _carry = new THREE.Group();
    const bagM = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.1), bagM); bag.position.y = -0.2; bag.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), bagM); handle.position.y = -0.05;
    const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), new THREE.MeshStandardMaterial({ color: 0xa87a4a, roughness: 0.9 }));
    parcel.position.y = -0.14; parcel.castShadow = true;
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: 0xe8e0c0 }));
    string.position.y = -0.14; parcel.add(string); string.position.set(0, 0, 0);
    _carry.userData = { bag: new THREE.Group(), parcel: parcel };
    _carry.userData.bag.add(bag, handle);
    _carry.add(_carry.userData.bag, parcel);
    _carry.position.set(0, -0.36, 0.02);
    playerRig.armR.elbow.add(_carry);
  }
  const job = JOBS.active, carrying = !!(job && job.carry && job.carryOn);
  _carry.userData.parcel.visible = carrying;
  _carry.userData.bag.visible = !carrying && econ.bag.some(b => b.kind !== 'big' && b.kind !== 'ticket' && b.kind !== 'outfit');
}

// ======================================================================================================
// Jobs: take one at a time from the Jobs board, follow the yellow beam, get paid in cash
// ======================================================================================================
const JOBS = { offers: [], active: null, beam: null, pickups: [] };
function roomsWhere(f) { return (typeof ROOMS !== 'undefined' ? ROOMS : []).filter(f); }
function rpick(a) { return a[(Math.random() * a.length) | 0]; }
function placeOfRoom(r, verb) { return { x: r.center[0], z: r.center[1], r: 3.2, label: (verb || 'Go to') + ' ' + r.name, place: r.name }; }
const SHOPISH = (r) => !r.open && !/museum|palace|station|temple|church|masjid|police|fire|hospital|school|kseb|post|bank|theatre|market|depot|fuel|kiosk/i.test(r.kind + ' ' + r.name);
function dist2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function payFor(d, base, perM) { return Math.round((base + d * perM) / 10) * 10; }
function lmPlace(key, verb, r) { const L = LANDMARKS[key]; return { x: L.pos.x, z: L.pos.z, r: r || 14, label: verb + ' ' + L.name, place: L.name }; }

const JOB_TYPES = [
  function courier() {
    const post = roomsWhere(r => /post/i.test(r.name))[0], shop = rpick(roomsWhere(SHOPISH));
    if (!post || !shop) return null;
    const a = placeOfRoom(post, 'Collect the parcel at'), b = placeOfRoom(shop, 'Deliver the parcel to');
    return { icon: '📦', title: 'Courier run', giver: 'India Post', desc: 'A registered parcel for ' + shop.name + '. Collect it at the post office counter and deliver it by hand.',
      steps: [a, Object.assign(b, { done: 'Parcel delivered - signed for at the counter.' })], carry: true, reward: payFor(dist2(a, b), 70, 0.3) };
  },
  function fishDelivery() {
    const hotel = rpick(roomsWhere(r => /hotel|restaurant|meals|biriyani/i.test(r.name) && !/lodge/i.test(r.name)));
    if (!hotel || !FISH_STALL.pos) return null;
    const a = { x: FISH_STALL.pos.x, z: FISH_STALL.pos.z, r: 3, label: 'Collect the fish crate at the fish stall, Nilambur Market', place: 'Fish stall' };
    const b = placeOfRoom(hotel, 'Deliver the fish to the kitchen of');
    return { icon: '🐟', title: 'Fish delivery', giver: 'Market fishmonger', desc: 'The morning catch has to reach ' + hotel.name + '\'s kitchen before lunch - on ice, and quickly!',
      steps: [a, Object.assign(b, { done: 'The cook checks the gills - "Fresh! Good."' })], carry: true, reward: payFor(dist2(a, b), 90, 0.35) };
  },
  function newspaper() {
    const shops = roomsWhere(SHOPISH).sort(() => Math.random() - 0.5).slice(0, 4);
    if (shops.length < 3 || !KIOSK.pos) return null;
    const a = { x: KIOSK.pos.x, z: KIOSK.pos.z, r: 3, label: 'Pick up the newspapers at the bus stand tea stall', place: 'Bus stand tea stall' };
    return { icon: '📰', title: 'Newspaper round', giver: 'Mathrubhumi agent', desc: 'Drop the morning papers at ' + shops.length + ' shops around town.',
      steps: [a].concat(shops.map((s, i) => Object.assign(placeOfRoom(s, 'Drop a paper at'), { done: 'Paper ' + (i + 1) + ' of ' + shops.length + ' delivered.' }))), carry: true, reward: 50 + 45 * shops.length };
  },
  function porter() {
    const shop = rpick(roomsWhere(r => /provision|store|mart|grocery|super/i.test(r.name) && SHOPISH(r)));
    if (!shop || !FISH_STALL.veg) return null;
    const a = { x: FISH_STALL.veg.x, z: FISH_STALL.veg.z, r: 3, label: 'Lift the sack at the vegetable stall, Nilambur Market', place: 'Vegetable stall' };
    const b = placeOfRoom(shop, 'Carry the sack to');
    return { icon: '🥔', title: 'Market porter', giver: 'Vegetable wholesaler', desc: 'A 25 kg sack of onions for ' + shop.name + '. Heavy - mind your back!',
      steps: [a, Object.assign(b, { done: 'Sack dropped in the storeroom.' })], carry: true, reward: payFor(dist2(a, b), 80, 0.3) };
  },
  function passenger() {
    const dest = rpick(['museum', 'palace', 'railway', 'bridge', 'conolly', 'temple', 'church']);
    if (!LANDMARKS[dest] || !LANDMARKS.busstation) return null;
    const a = lmPlace('busstation', 'Drive to the passenger waiting at', 16), b = lmPlace(dest, 'Drive the passenger to', 18);
    a.drive = b.drive = true;
    return { icon: '🛺', title: 'Passenger run', giver: 'Auto stand', desc: 'A tourist at the bus station wants a ride to ' + LANDMARKS[dest].name + '. Take any auto, car or bike - you must be driving.',
      steps: [Object.assign(a, { done: 'The passenger climbs in: "' + LANDMARKS[dest].name + ', please!"' }), Object.assign(b, { done: 'The passenger pays and thanks you.' })], reward: payFor(dist2(a, b), 120, 0.4) };
  },
  function teakSeeds() {
    if (!LANDMARKS.conolly || !LANDMARKS.museum) return null;
    const c = LANDMARKS.conolly.pos;
    return { icon: '🌰', title: 'Teak seed collection', giver: 'Forest Department', desc: 'Collect 6 fallen teak seeds in Conolly\'s Plot for the nursery, then hand them in at the Teak Museum.',
      steps: [{ x: c.x, z: c.z, r: 26, label: 'Collect 6 teak seeds in Conolly\'s Plot', place: 'Conolly\'s Plot', collect: 6 },
        Object.assign(lmPlace('museum', 'Hand the seeds in at', 12), { done: 'The forest officer counts the seeds - "These will be teak trees in 60 years!"' })], carry: true, reward: 240 };
  },
  function springWater() {
    if (!window.SPRING_MESH || !LANDMARKS.hospital) return null;
    const v = new THREE.Vector3(); window.SPRING_MESH.getWorldPosition(v);
    const hosp = roomsWhere(r => /hospital/i.test(r.name))[0];
    const b = hosp ? placeOfRoom(hosp, 'Take the sample to the lab at') : lmPlace('hospital', 'Take the sample to', 12);
    return { icon: '💧', title: 'Spring water sample', giver: 'Taluk Hospital lab', desc: 'Climb the spring trail above Adyanpara Falls, fill a sample bottle at the spring, and bring it to the hospital lab for testing.',
      steps: [{ x: v.x, z: v.z, r: 4.5, label: 'Fill a bottle at the spring above Adyanpara Falls', place: 'Adyanpara spring', done: 'Sample bottle filled - cold and clear.' },
        Object.assign(b, { done: 'The lab technician labels it: "Potable - excellent!"' })], carry: true, reward: 380 };
  }
];
function newOffer(exclude) {
  for (let t = 0; t < 20; t++) {
    const f = rpick(JOB_TYPES);
    if (exclude && exclude.indexOf(f.name) >= 0) continue;
    const j = f(); if (j) { j.type = f.name; return j; }
  }
  return null;
}
function fillOffers() {
  while (JOBS.offers.length < 4) {
    const j = newOffer(JOBS.offers.map(o => o.type));
    if (!j) break;
    JOBS.offers.push(j);
  }
}
function openJobs() { fillOffers(); openModal('jobs-modal'); _jobsOpen = true; renderJobs(); }
function renderJobs() {
  const list = $('jobs-list'); list.textContent = '';
  $('jobs-cash').textContent = 'Cash in hand: ' + fmtRs(econ.cash) + ' · jobs done: ' + (econ.jobsDone || 0);
  if (typeof ADS !== 'undefined' && ADS.enabled) {   // rewarded ad for quick cash (ads.js)
    const left = adCashLeft(), card = el('div', 'job-card ad-card');
    card.appendChild(el('div', 'job-title', '📺 Short on cash?'));
    card.appendChild(el('div', 'job-desc', left > 0 ? 'Watch a short ad and get ' + fmtRs(ADS_CONFIG.rewardCash) + ' cash straight away (' + left + ' left this hour).' : "You've used this hour's ad rewards - take a job instead!"));
    const b = el('button', 'btn-teleport btn-ad', '▶ Watch a short ad for ' + fmtRs(ADS_CONFIG.rewardCash)); b.type = 'button'; b.disabled = left <= 0;
    b.onclick = () => watchAdForCash('jobs');
    card.appendChild(b); list.appendChild(card);
  }
  if (JOBS.active) {
    const a = JOBS.active, row = el('div', 'job-card active');
    row.appendChild(el('div', 'job-title', a.icon + ' ' + a.title + ' - in progress'));
    row.appendChild(el('div', 'job-desc', a.steps[a.step].label + ' (step ' + (a.step + 1) + ' of ' + a.steps.length + ')'));
    const c = el('button', 'btn-teleport', 'Give up this job'); c.type = 'button';
    c.onclick = () => { abandonJob(); renderJobs(); };
    row.appendChild(c); list.appendChild(row);
  }
  for (const j of JOBS.offers) {
    const row = el('div', 'job-card');
    const top = el('div', 'job-title', j.icon + ' ' + j.title);
    top.appendChild(el('span', 'job-pay', fmtRs(j.reward)));
    row.appendChild(top);
    row.appendChild(el('div', 'job-desc', j.desc));
    const d = Math.round(dist2(state.playerPos, j.steps[0]));
    row.appendChild(el('small', 'job-meta', j.giver + ' · start ' + d + ' m away' + (j.steps.some(s => s.drive) ? ' · needs a vehicle' : '')));
    const b = el('button', 'btn-teleport', 'Take this job'); b.type = 'button'; b.disabled = !!JOBS.active;
    b.onclick = () => { acceptJob(j); closeEconModals(); };
    row.appendChild(b);
    list.appendChild(row);
  }
}
function acceptJob(j) {
  JOBS.offers = JOBS.offers.filter(o => o !== j);
  j.step = 0; j.carryOn = false; j.got = 0;
  JOBS.active = j;
  econ.job = null;
  startStep();
  triggerLandmarkPopup(j.icon + ' Job taken: ' + j.title, j.steps[0].label + '. Follow the yellow beam (it\'s on your map too). Pay: ' + fmtRs(j.reward) + ' cash.');
  refreshEconUI();
}
function abandonJob() { clearPickups(); JOBS.active = null; refreshEconUI(); }
function startStep() {
  const j = JOBS.active, s = j.steps[j.step];
  clearPickups();
  if (s.collect) spawnPickups(s, s.collect);
}
function completeStep() {
  const j = JOBS.active, s = j.steps[j.step];
  if (j.step === 0 && j.carry) j.carryOn = true;
  j.step++;
  if (j.step >= j.steps.length) {
    JOBS.active = null; clearPickups();
    econ.jobsDone = (econ.jobsDone || 0) + 1;
    earnCash(j.reward);
    triggerLandmarkPopup('💰 Job done: ' + j.title, (s.done ? s.done + ' ' : '') + 'You were paid ' + fmtRs(j.reward) + ' in cash. More work on the 💼 Jobs board.');
    fillOffers();
  } else {
    startStep();
    triggerLandmarkPopup(j.icon + ' ' + j.title, (s.done ? s.done + ' ' : '') + 'Next: ' + j.steps[j.step].label + '.');
    if (typeof chime === 'function') chime([784], 0.3);
  }
  refreshEconUI();
}

// Collectibles (teak seeds): glowing pods scattered on the ground, picked up by walking over them
function spawnPickups(s, n) {
  const geo = new THREE.SphereGeometry(0.09, 8, 6), mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.8 });
  const ringG = new THREE.TorusGeometry(0.35, 0.03, 4, 16), ringM = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.8 });
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * (s.r - 8);
    const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d, y = groundHeight(x, z);
    const g = new THREE.Group(); g.position.set(x, y + 0.1, z);
    const seed = new THREE.Mesh(geo, mat); seed.scale.set(1, 0.8, 1.3); g.add(seed);
    const ring = new THREE.Mesh(ringG, ringM); ring.rotation.x = Math.PI / 2; ring.position.y = -0.05; g.add(ring);
    scene.add(g);
    JOBS.pickups.push(g);
  }
}
function clearPickups() { JOBS.pickups.forEach(g => scene.remove(g)); JOBS.pickups = []; }

// Called every frame from main.js's animate()
function econTick(dt) {
  if (!_carry) updateCarry();
  const j = JOBS.active, hud = $('job-hud');
  if (!JOBS.beam && typeof scene !== 'undefined' && scene) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    JOBS.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 70, 16, 1, true), m);
    JOBS.beam.visible = false; scene.add(JOBS.beam);
  }
  if (!j) { if (JOBS.beam) JOBS.beam.visible = false; if (hud) hud.classList.remove('show'); window.JOB_TARGET = null; return; }
  const s = j.steps[j.step], p = state.playerPos;
  window.JOB_TARGET = s;
  JOBS.beam.visible = true;
  JOBS.beam.position.set(s.x, groundHeight(s.x, s.z) + 35, s.z);
  JOBS.beam.material.opacity = 0.2 + Math.sin(performance.now() / 300) * 0.08;
  let extra = '';
  if (s.collect) {
    for (let i = JOBS.pickups.length - 1; i >= 0; i--) {
      const g = JOBS.pickups[i];
      g.rotation.y += dt * 2;
      if (Math.hypot(g.position.x - p.x, g.position.z - p.z) < 1.4 && Math.abs(g.position.y - p.y) < 2.5) {
        scene.remove(g); JOBS.pickups.splice(i, 1); j.got++;
        if (typeof chime === 'function') chime([1175], 0.25);
      }
    }
    extra = ' · ' + j.got + ' / ' + s.collect + ' found';
    if (j.got >= s.collect) { completeStep(); return; }
  } else {
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    const ok = d < s.r && (!s.drive || state.driving);
    extra = ' · ' + Math.round(d) + ' m' + (s.drive && !state.driving ? ' · get in a vehicle' : '');
    if (ok) { completeStep(); return; }
  }
  if (hud) {
    hud.textContent = j.icon + ' ' + j.title + ': ' + s.label + extra + ' · pay ' + fmtRs(j.reward);
    hud.classList.add('show');
  }
}

// Minimap / full-map marker for the current job target (main.js's drawMapContent calls this)
function drawJobOnMap(ctx, mapX, mapZ) {
  const s = window.JOB_TARGET; if (!s) return;
  const x = mapX(s.x), z = mapZ(s.z);
  ctx.save();
  ctx.fillStyle = '#FFD54F'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, z - 11); ctx.lineTo(x + 7, z); ctx.lineTo(x, z + 11); ctx.lineTo(x - 7, z); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ======================================================================================================
// Fish on the ice: real fish models, one InstancedMesh per species, following the stall's stock
// ======================================================================================================
const FISH_STALL = { pos: null, veg: null };
const KIOSK = { pos: null };
// species look: length (m), profile height & thickness as fractions of length, belly/back colours
const FISH_LOOK = {
  mathi: { len: 0.16, h: 0.2, t: 0.1, belly: 0xd8e0e6, back: 0x2f5f80, n: 14 },
  ayala: { len: 0.24, h: 0.23, t: 0.12, belly: 0xdcd8c8, back: 0x2f6a5a, n: 10 },
  karimeen: { len: 0.2, h: 0.45, t: 0.12, belly: 0x9aa890, back: 0x2a3428, n: 8, bands: true },
  neymeen: { len: 0.7, h: 0.16, t: 0.08, belly: 0xe4e8ec, back: 0x5a6a7a, n: 4 },
  choora: { len: 0.5, h: 0.27, t: 0.16, belly: 0xb8c0cc, back: 0x1a2a4a, n: 5 },
  chemmeen: { prawn: true, len: 0.12, belly: 0xf08a6a, back: 0xe06a4a, n: 16 }
};
function fishGeometry(L) {
  // body ellipsoid (belly->back colour gradient), a forked tail, a dorsal fin and eyes; unit = 1 m
  const parts = [];
  const push = (g, m, colFn) => {
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(m);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { colFn(pos.getX(i), pos.getY(i), pos.getZ(i), c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  const belly = new THREE.Color(L.belly), back = new THREE.Color(L.back), dark = new THREE.Color(0x151515);
  const M = (x, y, z, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  if (L.prawn) {
    const l = L.len;
    push(new THREE.TorusGeometry(l * 0.45, l * 0.14, 6, 10, Math.PI * 1.2), M(0, 0, 0, Math.PI / 2, 0, 0, 1, 1, 1), (x, y, z, c) => c.copy(belly).lerp(back, 0.5 + 0.5 * Math.sin(x * 90)));
    push(new THREE.ConeGeometry(l * 0.12, l * 0.35, 4), M(l * 0.45, 0, l * 0.1, 0, 0, -Math.PI / 2, 1, 0.4, 1), (x, y, z, c) => c.copy(back));
  } else {
    const l = L.len, h = l * L.h, t = l * L.t;
    push(new THREE.SphereGeometry(0.5, 12, 8), M(0, 0, 0, 0, 0, 0, l * 0.82, h, t), (x, y, z, c) => {
      const k = THREE.MathUtils.clamp(y / h + 0.5, 0, 1);
      c.copy(belly).lerp(back, k * k);
      if (L.bands && Math.sin(x / l * 40) > 0.6 && k > 0.3) c.multiplyScalar(0.55);
    });
    push(new THREE.ConeGeometry(h * 0.55, l * 0.24, 4), M(-l * 0.5, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.15), (x, y, z, c) => c.copy(back).lerp(belly, 0.3));
    push(new THREE.ConeGeometry(h * 0.25, l * 0.3, 3), M(-l * 0.02, h * 0.45, 0, 0, 0, 0, 1.4, 1, 0.12), (x, y, z, c) => c.copy(back));
    for (const sz of [-1, 1]) push(new THREE.SphereGeometry(h * 0.1, 6, 4), M(l * 0.3, h * 0.12, sz * t * 0.38, 0, 0, 0, 1, 1, 0.5), (x, y, z, c) => c.copy(dark));
  }
  // concatenate
  let n = 0; parts.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  parts.forEach(g => { const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += c; });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
// Lays the species out on a tray of crushed ice (tw x td, centred at local lx,lz, top at local y)
// and hides fish as the stall's stock drops.
function fishTray(T, lx, ly, lz, tw, td, id, shop) {
  const L = FISH_LOOK[id];
  T.box('paint', tw, 0.05, td, lx, ly + 0.025, lz, 0xdfeef2);                 // crushed ice bed
  for (let k = 0; k < 10; k++) T.box('cglass', 0.05, 0.03, 0.05, lx - tw / 2 + 0.08 + (k * 0.37 % (tw - 0.16)), ly + 0.06, lz - td / 2 + 0.08 + (k * 0.53 % (td - 0.16)));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 });
  const mesh = new THREE.InstancedMesh(fishGeometry(L), mat, L.n);
  const cols = Math.max(1, Math.floor(tw / (L.len * (L.prawn ? 1.1 : 1.05)))), rows = Math.ceil(L.n / cols);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < L.n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const llx = lx - tw / 2 + (c + 0.5) * tw / cols, llz = lz - td / 2 + (r + 0.5) * td / rows;
    const w = T.w(llx, llz);
    const flip = (i % 2) ? Math.PI : 0;
    const thick = L.prawn ? L.len * 0.14 : L.len * L.t / 2;
    v.set(w[0], T.by + ly + 0.05 + thick + (r % 2) * 0.01, w[1]);
    // lying on its side (profile facing up), heads alternating, a little jitter
    e.set(L.prawn ? 0 : Math.PI / 2, (T.ry || 0) + flip + (i * 0.37 % 0.3) - 0.15, 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(v, q, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  const item = shop.items.find(i => i.id === id);
  const sync = () => { mesh.count = Math.ceil(L.n * Math.max(0, item.left) / item.stock); };
  shop.listeners.push(sync); sync();
  return mesh;
}
// Two fish stalls at the market (local stall centres x, z; stall top at local y)
function buildFishStalls(R, stalls, topY, shop) {
  const ids = ['mathi', 'ayala', 'karimeen', 'neymeen', 'choora', 'chemmeen'];
  stalls.forEach((st, si) => {
    for (let k = 0; k < 3; k++) {
      const id = ids[si * 3 + k];
      const tw = 0.92, td = id === 'neymeen' ? 1.1 : 0.95;
      fishTray(R, st.x - 0.98 + k * 0.98, topY, st.z + 0.05, tw, td, id, shop);
    }
  });
}

// ======================================================================================================
// DOM wiring
// ======================================================================================================
window.addEventListener('DOMContentLoaded', () => {
  const on = (id, f) => { const e = $(id); if (e) e.addEventListener('click', f); };
  on('btn-wallet', openBag);
  on('btn-jobs', openJobs);
  on('shop-pay', payShop);
  ['shop-close', 'bag-close', 'jobs-close', 'garage-close'].forEach(id => on(id, closeEconModals));
  ['shop-modal', 'bag-modal', 'jobs-modal', 'garage-modal'].forEach(id => { const m = $(id); if (m) m.addEventListener('mousedown', (e) => { if (e.target === m) closeEconModals(); }); });
  refreshEconUI();
});
