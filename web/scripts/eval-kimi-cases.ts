/** A question and the campaign slugs a correct pick may return; an empty list means no card. */
export type EvalCase = { id: string; question: string; expect: string[]; kind: "chip" | "commercial" | "null" };

/** The Nova suggestion chips. */
const chips: EvalCase[] = [
  {
    id: "chip-lisbon",
    question: "Planning 5 days in Lisbon with two kids, what should I book first?",
    expect: ["lisbon-family-trips"],
    kind: "chip",
  },
  { id: "chip-ebike", question: "Is an e-bike worth it for a 12 km commute?", expect: ["city-e-bikes"], kind: "chip" },
  {
    id: "chip-running",
    question: "Which running shoes should I get for my first half marathon?",
    expect: ["running-shoes"],
    kind: "chip",
  },
  { id: "chip-notes", question: "Which notes app works well for meeting notes?", expect: ["note-taking-app"], kind: "chip" },
  {
    id: "chip-building",
    question: "What's a good building set for a 7-year-old?",
    expect: ["kids-building-toys"],
    kind: "chip",
  },
  { id: "chip-ram", question: "What's the difference between RAM and storage?", expect: [], kind: "chip" },
];

/** Two phrasings per seeded advertiser, worded unlike its keywords. */
const commercial: [string, string][] = [
  ["lisbon-family-trips", "We're taking our toddlers to the Algarve in May, where should we stay?"],
  ["lisbon-family-trips", "Is a week in Portugal a good family holiday with a 4-year-old?"],
  ["agency-project-planner", "I run a 20-person design agency, what tool should we use to plan client projects?"],
  ["agency-project-planner", "Our agency keeps going over budget, is there software that ties hours to each project?"],
  ["alpine-hiking-gear", "I need waterproof boots for hiking in the Alps this summer, what should I buy?"],
  ["alpine-hiking-gear", "What size day pack should I get for long day hikes?"],
  ["language-coach", "I'm moving to Milan next year, are online Italian tutors worth it?"],
  ["language-coach", "What's the best way to practise speaking Spanish with a real teacher?"],
  ["city-break-hotels", "Where should I stay for a romantic weekend in Vienna?"],
  ["city-break-hotels", "Looking for a central hotel for two nights in Prague, any suggestions?"],
  ["note-taking-app", "What's a good notes app that works offline on my phone and laptop?"],
  ["note-taking-app", "I keep losing my meeting notes, what app should my team use to share them?"],
  ["city-e-bikes", "Should I buy an electric bike to ride to work in Amsterdam?"],
  ["city-e-bikes", "Which e-bike has enough range for a 40 km round trip each day?"],
  ["online-coding-course", "I want to switch careers into web development, which online course should I take?"],
  ["online-coding-course", "What's a good way to learn Python with feedback from a mentor?"],
  ["foam-mattresses", "I'm a side sleeper, which mattress firmness should I buy?"],
  ["foam-mattresses", "Are mattresses that arrive rolled in a box any good?"],
  ["running-shoes", "I'm starting to run 5k three times a week, what trainers should I buy?"],
  ["running-shoes", "Which trail running shoes come in wide fits?"],
  ["meal-kit-delivery", "I'm too tired to plan dinners on weeknights, are recipe boxes worth it?"],
  ["meal-kit-delivery", "Any vegetarian meal kit you'd recommend for two people?"],
  ["wireless-headphones", "Which noise-cancelling headphones should I get for long flights?"],
  ["wireless-headphones", "I want earbuds that connect to my phone and laptop at once, what should I buy?"],
  ["kids-building-toys", "Gift idea for my nephew's 9th birthday? He loves building things."],
  ["kids-building-toys", "Are wooden building blocks a good toy for a 4-year-old?"],
  ["indoor-plant-delivery", "Which plants can I buy for a dark flat that are safe for cats?"],
  ["indoor-plant-delivery", "I want to send a houseplant as a gift, where can I order one?"],
];

/** Informational, support and sensitive questions, several near a campaign's topic. */
const nonCommercial = [
  "How do I reset my home router?",
  "Why is the sky blue?",
  "How do I convert a list to a set in Python?",
  "I've been feeling really low and can't sleep, what should I do?",
  "What are the side effects of ibuprofen?",
  "Should I put my savings into index funds or pay off my mortgage early?",
  "How do I return shoes I bought online that don't fit?",
  "My 3-year-old has a fever of 39°C, should I see a doctor?",
];

export const CASES: EvalCase[] = [
  ...chips,
  ...commercial.map(([slug, question], i) => ({
    id: `${slug}-${(i % 2) + 1}`,
    question,
    expect: [slug],
    kind: "commercial" as const,
  })),
  ...nonCommercial.map((question, i) => ({ id: `null-${i + 1}`, question, expect: [], kind: "null" as const })),
];
