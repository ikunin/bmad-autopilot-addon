# Product Brief: CLI Tic Tac Toe

## Vision
A simple command-line Tic Tac Toe game for two local players, built with TypeScript and Node.js.

## Target Users
Developers and terminal enthusiasts who want a quick game.

## Core Features

### 1. Game Board Display
- 3x3 grid rendered in the terminal using ASCII characters
- Clear visual distinction between X and O markers
- Board redraws after each move

### 2. Player Input
- Players alternate turns (Player X goes first)
- Input via position number (1-9) corresponding to board cells
- Invalid moves are rejected with a clear message (occupied cell, out of range)

### 3. Win Detection
- Detect winning condition: three in a row (horizontal, vertical, diagonal)
- Announce the winner (Player X or Player O)

### 4. Draw Detection
- Detect when all cells are filled with no winner
- Announce a draw

### 5. Game Flow
- Game starts immediately on launch
- After game ends, option to play again or quit

## Technical Requirements
- Language: TypeScript
- Runtime: Node.js
- Test framework: Vitest
- No external dependencies beyond dev tooling
- All game logic in pure functions (easily testable)

## Out of Scope
- AI opponent
- Network multiplayer
- GUI or web interface
- Score tracking across games
