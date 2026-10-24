// The example bundles of the manual, in the IR. Each file is one request, the
// answer a model should give, and tags the manual matches against the request.
// `after` lists examples whose bundles are applied first (a patch needs a space
// to patch); `space` is the base the example is checked on. Every file of this
// directory must be listed here: tests/kit-manual.test.mjs compares the two.
import carbs from "./carbs.json" with { type: "json" };
import creatineRefuse from "./creatine-refuse.json" with { type: "json" };
import docs from "./docs.json" with { type: "json" };
import dry from "./dry.json" with { type: "json" };
import exam from "./exam.json" with { type: "json" };
import flossing from "./flossing.json" with { type: "json" };
import gymbag from "./gymbag.json" with { type: "json" };
import lastmeal from "./lastmeal.json" with { type: "json" };
import meditation from "./meditation.json" with { type: "json" };
import meditationRemove from "./meditation-remove.json" with { type: "json" };
import odo from "./odo.json" with { type: "json" };
import plants from "./plants.json" with { type: "json" };
import posture from "./posture.json" with { type: "json" };
import repair from "./repair.json" with { type: "json" };
import rides from "./rides.json" with { type: "json" };
import shakes from "./shakes.json" with { type: "json" };
import ski from "./ski.json" with { type: "json" };
import skiGoal from "./ski-goal.json" with { type: "json" };
import skiHome from "./ski-home.json" with { type: "json" };
import skiStyle from "./ski-style.json" with { type: "json" };
import taxi from "./taxi.json" with { type: "json" };
import veg from "./veg.json" with { type: "json" };
import walks from "./walks.json" with { type: "json" };

export const EXAMPLES = Object.freeze([
  shakes, meditation, gymbag, flossing, dry, ski, rides, lastmeal, veg, carbs, posture,
  plants, walks, exam, repair, taxi, odo, docs,
  skiStyle, skiHome, skiGoal, meditationRemove, creatineRefuse,
]);

export const exampleById = (id) => EXAMPLES.find((example) => example.id === id) || null;
