import ung from 'unique-names-generator';

const { adjectives, animals, colors, uniqueNamesGenerator } = ung;

export function generateReadableId(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: '-',
    length: 3,
    style: 'lowerCase',
  });
}
