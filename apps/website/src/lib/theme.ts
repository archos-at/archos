import tokens from '../styles/brand/tokens.css?raw';

const match = tokens.match(/--surface:\s*(#[0-9a-fA-F]{3,8})/);
if (!match) throw new Error('tokens.css declares no --surface colour');

export const surfaceColor: string = match[1];
