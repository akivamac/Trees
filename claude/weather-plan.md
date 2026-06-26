# Weather System Implementation

## Context
The game has day/night cycle, fire, and warmth but no weather. The spec calls for rain, wind, and overcast affecting fire, warmth, traversal, and sound. Weather adds danger and variety — without it the world feels static.

## Design

### Weather State
Add to `state.js`:
```
weather: { type: 'clear', wind: 0, windDir: 0, intensity: 0, nextChange: 0 }
```
- `type`: `'clear'` | `'overcast'` | `'rain'` | `'storm'`
- `wind`: 0–1 strength
- `windDir`: radians (0 = north)
- `intensity`: 0–1 (rain heaviness)
- `nextChange`: game-minute when weather transitions

### Weather Transitions (in animate loop)
- Every 2–6 game hours, roll new weather
- Season affects probability: summer = mostly clear, winter = more rain/storm
- Transitions fade over ~30 game-seconds (lerp intensity)
- Chain: clear → overcast → rain → storm → rain → overcast → clear (gradual)

### Visual Effects

**Rain particles** — new `js/weather.js` module:
- THREE.Points with BufferGeometry (~2000 particles for rain, ~500 for light rain)
- Fall from y=20 to y=0 in camera-relative area (30×30 around player)
- Recycle at ground, wind pushes sideways
- Storm = more + faster + occasional lightning flash

**Overcast** — darken sky:
- Lerp sky color toward grey (0x808088) based on intensity
- Reduce sun intensity by `intensity × 0.7`
- Increase fog density from 0.018 → 0.028

**Wind visuals**:
- Billboard trees: small oscillating `rotation.z` based on wind strength

**Lightning** (storm only):
- Random flash: ambient to 2.0 for 100ms, every 20–40s during storm

### Gameplay Effects

**Warmth** (in `updateVitals`):
- Rain: extra drain `-0.15 * intensity * delta`
- Wind chill: extra drain `-0.08 * wind * delta`

**Fire**:
- Rain > 0.5: campfires slowly die
- Rain > 0.8: extinguish after 30s
- Wind > 0.5: match strike fails

**Stamina**: Rain +20% drain, Storm +40%

**Fishing**: Storm blocks fishing

### UI
- Sidebar header: show weather next to season ("Clear" / "Overcast" / "Rain" / "Storm")
- Optional wind direction text

### Files to Modify
1. **`js/state.js`** — add `weather` to state + save/load
2. **`js/weather.js`** (NEW) — WeatherManager: particles, sky modifiers, transitions
3. **`js/main.js`** — integrate into animate loop, updateVitals, fire, fishing
4. **`js/ui.js`** — weather display in sidebar
5. **`index.html`** — weather label element

### WeatherManager API (js/weather.js)
```js
export class WeatherManager {
  constructor(scene, camera)
  update(delta, gameTime, season) // transitions + particles
  getType()      // 'clear'|'overcast'|'rain'|'storm'
  getWind()      // { strength: 0-1, dir: radians }
  getIntensity() // 0-1
  getSkyMod()    // { colorLerp: 0-1, fogDensity, sunDim }
  setState(saved) // restore from save
  getState()      // for saving
}
```

## Verification
1. Wait — weather transitions from clear → overcast → rain
2. Sky darkens, rain particles fall, wind sways trees
3. Warmth drains faster in rain
4. Campfire dies in heavy rain
5. Match fails in wind
6. Save during rain → reload → rain persists
7. Sidebar shows weather type
