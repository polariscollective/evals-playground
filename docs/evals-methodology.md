# This tool aims to easily launch flexible but potentially really complete evals (feedback request below)

- Why easily? A UI is made for humans to quickly try a scenario, and an MCP is available so an agent can plan a draft of evaluation containing a batch of scenarios and judge behavior in order to score these. A general heat map is then created for an easy overview; MCP endpoints are also available to read the results and trajectories of the experiment (`get_run_results`, `get_run_trajectory`) so it can be further analyzed by an agent
- The whole project is created on top of Inspect AI, and actual Inspect AI logs are also available in-app
- An example of such eval experiment run (here, a dummy one) with results (heat map + trajectories) and analysis can be found [here](https://evals-playground.polariscollective.org/eval/4b2abeb0-d594-44af-b179-c13b91bb62e7)

## How to create a good scenario?

While Petri is mainly created for exploration, it might not be fully robust when the goal is to test a specific behavior, by making batches of scenarios all slightly differing by a controllable parameter (a tool, a sentence, the environment). But we still took all the advice found in Petri and other documentation in order to create good and realistic scenarios. These guidelines can be found at [/advice](https://evals-playground.polariscollective.org/shared/advice) and are available via MCP as well (`read_advice`, which serves all four; `read_scenario_advice` still serves the first alone).

## What each experiment can do?

All *runs* (a batch of scenarios run on many, on-demand, evaluated models) have:

- N scenarios, that will be run K times on P models, making N x K x P conversations
- Each scenario can be, if needed, multi-turn (M turns) with an adversary model (on demand). This adversary is given a goal — hidden from the evaluated model.
- At the end of the conversation, the full text is evaluated by at least one principal judge (+ other secondary judges if needed). This judge can be asked anything, and can "score" the conversation on the scale the user wrote. A level of that scale can be marked `excluded` to mean "no data / not applicable", so it stays out of the average (we usually give it the value -1). This will be used for creating the heat map. By default, the heat map is an average over the K attempts, but other formulas could be used. This is really flexible on purpose
- A special judge, this *awareness judge* (`system_type: "awake"`, `check_eval_awareness`, enabled by default), has as its sole purpose to judge whether, based on the conversation, the evaluated model has likely realized it was tested. Its scale is fixed from 1 to 10, and the run-level warning lights up from 7 (`AWARENESS_ALARM`).
- A set of tools the evaluated model can call
- A *world*: the environment the tools have access to, in plain text (see the tool section)

## How each scenario can be initialized?

- A *system prompt* given to the evaluated model
- A *user prompt* as first message (then, if multi-turn, it will be the adversary model playing the role of the user)
- An optional *history of conversation*. In order to mimic a full multi-turn conversation that can be fully reproducible, it might be interesting to start the conversation after T turns. Interesting to let the model think it already completed some tasks or answered some questions itself earlier on
- A set of tools. While the set of tools is defined at run level, specific tools can be passed to the evaluated model if needed. By default they are all given.
- An optional specific *world* that will be attached to the full run *world* in order to make the environment slightly change from scenario to scenario. (see below)

## How is the tool simulated

- When a tool is given to the evaluated model, the output could be hard coded. Example: insert_data(data) -> "Data well inserted".
- But sometimes, we need to retrieve realistic output, based on the input (unpredictable, from the evaluated model). For that, each tool can have `retrieval_rules`, and the run names another model, called the *world model* (`models.world`). For example: multiply_by_2(number) with retrieval_rules = "Multiply the input by 2" -> the model will then reply, hopefully, n*2. In this example, it's a simple computation so we could have written a pseudo code for that. But in practice the goal is to make it as flexible as possible, hoping the model will answer correctly. (see the "check model" below)
- Finally, sometimes the result of the tool is not as simple and needs to be much more coherent across the whole conversation/full experiment. That's why we can create a *world* (global to the run and/or specific to the scenario). This world can for example describe a file system or a db, and the world model will, based on the retrieval rules, give a coherent output and/or update the scenario *world*.
- Finally, a *check model* is called in order to check if the output is coherent, to avoid mistakes (this check model is not chosen by hand: `check_model_for` picks it from `CHECK_MODELS`, always from a different provider family than the world model). Its verdict is stored on each served result (`tool_results.faithful`), it is taken into account by the final judges, and it is crossed with the *awareness judge*: a conversation the awareness judge flagged that also saw a non-faithful result tells us the environment broke, rather than the model being perceptive (here, independently of the *world*).

## Additional useful features

- *Extension*: All runs can be launched with few scenarios, models, attempts, judges or turns first but later *extended* with other scenarios, additional models, attempts and/or judges, or conversations can be **continued** to extend multi-turn conversation. The final results will be **appended** to the existing ones to complete the heat map UI. But within one run, all cases (K conversations of 1 scenario) should remain comparable.
- In addition to the evaluated models (`models.targets`), all other models can be chosen among an exhaustive list of models from the OpenAI, Anthropic, Google and xAI providers (`models.adversary`, `models.judge` and the secondary `judges`, `models.world`). The check model is the exception: it is not chosen, it is derived from the world model.
- Of course, the heat map can be further analyzed to have access to the full conversation, judges' scores and notes, warnings from the awareness judge, ...
- Inspect AI logs also available in-app

## Limitation

- Unlike Petri, it is not possible to go backward in a conversation. As the goal here is not to explore but to build robust experiments, a made up history can be entered during scenario initialization to test these kinds of assumptions.
- The conversation is only analyzed and scored by the judge (`models.judge`) at the end of it, after M turns (it would be too expensive). The consequence is that if the adversary model achieved its goal early on, the conversation will keep going and maybe provide weird results. The judge should however be able to correctly score and note the conversation. Alternatives could be:
    - to, optionally, implement that feature even if expensive
    - to allow deterministic scoring (did the evaluated model call this specific tool with this specific input) so a language model is not needed for scoring
    - to run with few turns first, then **extend** the run with additional turns. When extending, we can decide to extend only conversations with specific scores given by the model (`deepen`, already implemented, but not an ideal solution for this)
    - accept this is not really an issue

# Feedback request

Feel free to reach out via [sam@polariscollective.org](mailto:sam@polariscollective.org)

Points where outside feedback can be most useful:

- What capabilities are obviously missing, at the run, scenario or judge level?
- How fragile is the combination of `retrieval_rules`, the *world*, the world model and the check model, as a way to simulate real tools without an actual coding environment or database, while keeping the setup fully flexible?
- What can be improved in the four advice documents at [/advice](https://evals-playground.polariscollective.org/shared/advice) — writing a scenario, putting a batch together, reading the results, writing a judge — and what other resources can feed them? Each one ends with the sources it draws on.
- What can such a tool be useful for beyond a single user? Internal tools can now be built quickly with Claude Code or Codex, but this one is deployed and served (which the MCP connection requires) and comes with the methodology already implemented.
