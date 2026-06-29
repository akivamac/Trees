// Tools that start physically on the ground near the bin (not inside it)
export const GROUND_TOOL_NAMES = ['Axe', 'Shovel', 'Fishing Rod', 'Knife'];

export const BIN_ITEMS = [
  'Matches', 'Tent', 'Canvas', 'Compass', 'Canteen', 'First Aid Kit', 'Barrel', 'Drying Rack', 'Rifle', 'Rifle Scope', 'Ammo Box (10)', 'Ammo Box (10)', 'Ammo Box (10)', 'Ammo Box (10)', 'Stick', 'Stick', 'Stick', 'Stick', 'Stick', 'Stick', 'Stone', 'Stone', 'Stone', 'Lantern', 'Lantern', 'Green Wood', 'Green Wood', 'Green Wood',
];

export const TOOLS = ['Axe', 'Shovel', 'Fishing Rod', 'Knife', 'Rifle'];
export const EQUIPPABLE = [...TOOLS, 'Matches', 'Tent', 'Canvas', 'Lantern', 'Barrel', 'Drying Rack'];

export const state = {
  player: {
    health:  100,
    hunger:  100,
    thirst:  100,
    stamina: 100,
    warmth:  100,
    sleep:   100,
    sickness: 0,
  },
  inventory: [],
  equippedTool: null,
  time: {
    hour: 8,
    minute: 0,
    day: 1,
    season: 'summer',
    weather: { condition: 'clear', wind: { speed: 2, dir: 180 }, nextChange: 300 },
  },
  skills: {
    woodcutting: 0,
    fishing:     0,
    hunting:     0,
    trapping:    0,
    foraging:    0,
    crafting:    0,
    building:    0,
    cooking:     0,
    medicine:    0,
    stealth:     0,
  },
  world: {
    trees:               [],
    structures:          [],
    items:               [],
    treeHealth:          {},
    binItems:            [...BIN_ITEMS],
    groundToolsPickedUp: [],
    campfires:           [], // { x, z, stage, lit }
    tents:               [], // { x, z, rot }
    beds:                [], // { x, z }
    fallenTrees:         [], // { x, z, treeHeight, fallDir, logSections, brokenBranches }
    traps:               [], // { type, x, z, rot, set, triggered, caught, catchTimer }
    barrels:             [], // { x, z, water (0-5) }
    lanterns:            [], // { x, z, on }
    carcasses:           [], // { x, z, kind, cutsLeft }
    worldMeat:           [], // { x, z, name }
    worldFish:           [], // { x, z, name }
    foragePatches:       [], // { x, z, type, depleted, regrowDay }
    dryingRacks:         [], // { x, z, rot, slot }
  },
  journal: [
    { day: 1, text: 'Arrived at the forest.' }
  ]
};

export function saveState() {
  try {
    localStorage.setItem('forest_save', JSON.stringify(state));
  } catch (e) {
    console.warn('Save failed:', e);
  }
}

export function loadState() {
  try {
    const saved = localStorage.getItem('forest_save');
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (parsed.player)    Object.assign(state.player, parsed.player);
    if (parsed.time)      Object.assign(state.time,   parsed.time);
    if (parsed.skills)    Object.assign(state.skills, parsed.skills);
    if (parsed.inventory) state.inventory    = parsed.inventory;
    if (parsed.journal)   state.journal      = parsed.journal;
    if (parsed.equippedTool !== undefined) state.equippedTool = parsed.equippedTool;
    if (parsed.world) {
      if (parsed.world.treeHealth)          state.world.treeHealth          = parsed.world.treeHealth;
      if (parsed.world.binItems)            state.world.binItems            = parsed.world.binItems;
      if (parsed.world.groundToolsPickedUp) state.world.groundToolsPickedUp = parsed.world.groundToolsPickedUp;
      if (parsed.world.campfires)           state.world.campfires           = parsed.world.campfires;
      if (parsed.world.tents)               state.world.tents               = parsed.world.tents;
      if (parsed.world.beds)                state.world.beds                = parsed.world.beds;
      if (parsed.world.structures)          state.world.structures          = parsed.world.structures;
      if (parsed.world.fallenTrees)         state.world.fallenTrees         = parsed.world.fallenTrees;
      if (parsed.world.traps)               state.world.traps               = parsed.world.traps;
      if (parsed.world.barrels)              state.world.barrels             = parsed.world.barrels;
      if (parsed.world.lanterns)             state.world.lanterns            = parsed.world.lanterns;
      if (parsed.world.carcasses)           state.world.carcasses           = parsed.world.carcasses;
      if (parsed.world.worldMeat)           state.world.worldMeat           = parsed.world.worldMeat;
      if (parsed.world.worldFish)           state.world.worldFish           = parsed.world.worldFish;
      if (parsed.world.foragePatches)       state.world.foragePatches       = parsed.world.foragePatches;
      if (parsed.world.dryingRacks)         state.world.dryingRacks         = parsed.world.dryingRacks;
    }
  } catch (e) {
    console.warn('Load failed:', e);
  }
}
