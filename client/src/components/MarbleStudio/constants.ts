import {
    Wand2,
    Sparkles,
    ZapIcon,
    ImageIcon,
} from 'lucide-react';

export const MODELS = [
    { value: 'marble-1.1', label: 'Marble 1.1', sub: 'Standard', icon: Wand2 },
    {
        value: 'marble-1.1-plus',
        label: 'Marble 1.1 Plus',
        sub: 'Large worlds',
        icon: Sparkles,
    },
    {
        value: 'Marble 0.1-mini',
        label: 'Marble 0.1 Mini',
        sub: 'Fast · legacy',
        icon: ZapIcon,
    },
    {
        value: 'Marble 0.1-plus',
        label: 'Marble 0.1 Plus',
        sub: 'Legacy',
        icon: ImageIcon,
    },
];

export const PRESETS = [
    // Nature
    {
        category: 'Nature',
        label: 'Crystal Cavern',
        prompt: 'A vast underground crystal cavern with towering amethyst formations, stalactites dripping with mineral water, and a glowing subterranean lake casting violet light on ancient stone walls',
    },
    {
        category: 'Nature',
        label: 'Volcanic Shore',
        prompt: 'A dramatic volcanic shoreline where black lava fields meet turquoise waves, steam vents rising from obsidian cliffs, warm golden hour light illuminating sea spray and ash clouds',
    },
    {
        category: 'Nature',
        label: 'Ancient Rainforest',
        prompt: 'A primordial rainforest with moss-draped redwood trees hundreds of feet tall, shafts of diffused light piercing the dense canopy, luminescent fungi lining the forest floor',
    },
    {
        category: 'Nature',
        label: 'Arctic Glacier',
        prompt: 'A frozen arctic landscape of fractured glacier ice in shades of deep blue and white, aurora borealis shimmering overhead in curtains of green and violet, stars above',
    },
    // Architecture
    {
        category: 'Architecture',
        label: 'Gothic Cathedral',
        prompt: 'The interior of a massive gothic cathedral with soaring ribbed vaults, rose windows casting prismatic light across worn stone floors, centuries of candlelight soot on ancient walls',
    },
    {
        category: 'Architecture',
        label: 'Brutalist Tower',
        prompt: 'A towering brutalist megastructure complex with exposed raw concrete, striking geometric repetition, dramatic deep shadows, set against an overcast industrial sky',
    },
    {
        category: 'Architecture',
        label: 'Zen Garden',
        prompt: 'A perfectly raked Japanese rock garden surrounded by ancient wooden temple buildings, moss-covered stone lanterns, cherry blossom petals drifting in still air',
    },
    {
        category: 'Architecture',
        label: 'Abandoned Library',
        prompt: 'An enormous abandoned baroque library with floor-to-ceiling bookshelves spiraling upward, golden dusty light through cracked stained glass, ivy and vines reclaiming the ornate walls',
    },
    // Fantasy
    {
        category: 'Fantasy',
        label: 'Floating Islands',
        prompt: 'Luminous floating islands connected by ancient rope bridges, cascading waterfalls falling into the infinite void below, dense lush vegetation and glowing ruins of a lost civilization',
    },
    {
        category: 'Fantasy',
        label: 'Dragon Hoard',
        prompt: 'The treasure vault of an ancient dragon — mountains of gold coins, gemstones and enchanted artifacts piled high in a volcanic cavern lit by rivers of glowing magma',
    },
    {
        category: 'Fantasy',
        label: 'Fae Hollow',
        prompt: 'A magical hollow inside an impossibly large ancient oak, rooms carved from living wood, bioluminescent mushrooms everywhere, fairy lights, warm amber glow of countless tiny lanterns',
    },
    {
        category: 'Fantasy',
        label: 'Crystal Palace',
        prompt: 'An otherworldly crystal palace grown from a single enormous geode, translucent walls refracting rainbow light in every direction, gravity-defying architecture, floating crystal platforms',
    },
    // Sci-Fi
    {
        category: 'Sci-Fi',
        label: 'Derelict Station',
        prompt: 'An abandoned space station overgrown with alien vegetation, observation windows looking out to a ringed gas giant, long corridors lit only by flickering emergency red lighting',
    },
    {
        category: 'Sci-Fi',
        label: 'Neon Street',
        prompt: 'A rain-slicked cyberpunk street at night — holographic advertisements blaze through the rain, steam rises from grates, neon reflections shimmer in deep puddles, towers loom overhead',
    },
    {
        category: 'Sci-Fi',
        label: 'Alien Biome',
        prompt: 'A bioluminescent alien biome with towering translucent tree-like organisms, three moons visible through the strange canopy, floating creatures drifting through purple-tinted air',
    },
];
