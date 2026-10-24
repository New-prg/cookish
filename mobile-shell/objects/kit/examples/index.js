// The example bundles of the manual, in the IR. Each file is one request, the
// answer a model should give, and tags the manual matches against the request.
// `after` lists examples whose bundles are applied first (a patch needs a space
// to patch); `space` is the base the example is checked on. Every file of this
// directory must be listed here: tests/kit-manual.test.mjs compares the two.
import carbs from "./carbs.json" with { type: "json" };
import creatineRefuse from "./creatine-refuse.json" with { type: "json" };
import dry from "./dry.json" with { type: "json" };
import flossing from "./flossing.json" with { type: "json" };
import gymbag from "./gymbag.json" with { type: "json" };
import lastmeal from "./lastmeal.json" with { type: "json" };
import meditation from "./meditation.json" with { type: "json" };
import meditationRemove from "./meditation-remove.json" with { type: "json" };
import posture from "./posture.json" with { type: "json" };
import rides from "./rides.json" with { type: "json" };
import shakes from "./shakes.json" with { type: "json" };
import swim from "./swim.json" with { type: "json" };
import swimGoal from "./swim-goal.json" with { type: "json" };
import swimHome from "./swim-home.json" with { type: "json" };
import swimStyle from "./swim-style.json" with { type: "json" };
import veg from "./veg.json" with { type: "json" };

export const EXAMPLES = Object.freeze([
  shakes, meditation, gymbag, flossing, dry, swim, rides, lastmeal, veg, carbs, posture,
  swimStyle, swimHome, swimGoal, meditationRemove, creatineRefuse,
]);

export const exampleById = (id) => EXAMPLES.find((example) => example.id === id) || null;
