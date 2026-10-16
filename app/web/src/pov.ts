/** Point-of-view styles offered in Novel settings and the scene menu. `value` is what prompts receive. */
export type PovStyle = { value: string; label: string; pronoun: string; description: string; examples: string[]; needsCharacter: string };

export const POV_STYLES: PovStyle[] = [
  {
    value: 'first person', label: 'First person', pronoun: '“I”',
    description: 'The main character tells their own story. Readers only know what the narrator sees, thinks and feels, which feels intimate and immediate.',
    examples: ['The Hunger Games – Suzanne Collins', 'Jane Eyre – Charlotte Brontë', 'The Catcher in the Rye – J. D. Salinger'],
    needsCharacter: 'Narrator',
  },
  {
    value: 'first person peripheral', label: 'First person peripheral (witness)', pronoun: '“I”',
    description: 'A secondary character narrates and observes the hero from the outside, so the protagonist keeps some mystery.',
    examples: ['The Great Gatsby – F. Scott Fitzgerald (Nick)', 'Sherlock Holmes stories – Arthur Conan Doyle (Watson)'],
    needsCharacter: 'Narrator',
  },
  {
    value: 'first person multiple', label: 'First person, multiple narrators', pronoun: '“I”, rotating',
    description: 'Several characters each narrate their own chapters or scenes in first person. Set the narrator per scene from the scene menu.',
    examples: ['Gone Girl – Gillian Flynn', 'The Help – Kathryn Stockett', 'As I Lay Dying – William Faulkner'],
    needsCharacter: 'Default narrator',
  },
  {
    value: 'second person', label: 'Second person', pronoun: '“you”',
    description: 'The reader is addressed as “you” and put in the character’s shoes. Rare in novels, striking when it works.',
    examples: ['Bright Lights, Big City – Jay McInerney', 'The Fifth Season – N. K. Jemisin (in part)', 'Choose Your Own Adventure books'],
    needsCharacter: 'Who “you” is',
  },
  {
    value: 'third person limited', label: 'Third person limited (close third)', pronoun: '“he / she / they”',
    description: 'Told in third person but stays inside one character’s head: only their perceptions and thoughts. The most common choice in modern fiction.',
    examples: ['Harry Potter – J. K. Rowling', '1984 – George Orwell', 'The Name of the Wind (frame story) – Patrick Rothfuss'],
    needsCharacter: 'Viewpoint character',
  },
  {
    value: 'third person multiple', label: 'Third person multiple (rotating limited)', pronoun: '“he / she / they”, rotating',
    description: 'Close third person, but the viewpoint character changes between chapters or scenes. Set the viewpoint per scene from the scene menu.',
    examples: ['A Game of Thrones – George R. R. Martin', 'The Wheel of Time – Robert Jordan', 'Six of Crows – Leigh Bardugo'],
    needsCharacter: 'Default viewpoint character',
  },
  {
    value: 'third person omniscient', label: 'Third person omniscient', pronoun: '“he / she / they”',
    description: 'An all-knowing narrator who can dip into anyone’s thoughts, summarise, and comment on events. Classic and panoramic.',
    examples: ['The Lord of the Rings – J. R. R. Tolkien', 'Dune – Frank Herbert', 'Little Women – Louisa May Alcott'],
    needsCharacter: '',
  },
  {
    value: 'third person objective', label: 'Third person objective (camera)', pronoun: '“he / she / they”',
    description: 'Only what could be seen and heard, like a camera, with no character’s inner thoughts. Readers infer feelings from action and dialogue.',
    examples: ['Hills Like White Elephants – Ernest Hemingway', 'The Maltese Falcon – Dashiell Hammett'],
    needsCharacter: '',
  },
  {
    value: 'third person', label: 'Third person (unspecified)', pronoun: '“he / she / they”',
    description: 'Plain third person without saying how close the narration is. NovelCrafter’s default.',
    examples: [],
    needsCharacter: 'Main character (optional)',
  },
];

export const povStyle = (value: string) => POV_STYLES.find((p) => p.value === value) || POV_STYLES[POV_STYLES.length - 1];
