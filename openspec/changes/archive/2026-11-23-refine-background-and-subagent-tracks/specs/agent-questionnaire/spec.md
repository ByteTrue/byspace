# Spec Delta

## Purpose

Allows users to select and copy agent question text while preserving clear, accessible interaction with answer choices.

## ADDED Requirements

### Requirement: Question titles are selectable

The system SHALL allow mouse and keyboard selection of AskUser question titles even when an ancestor disables text selection for the surrounding stream.

#### Scenario: User drags across question text

- **WHEN** a user selects part of an AskUser title
- **THEN** the text becomes selected and can be copied

### Requirement: Choices remain controls rather than selectable prose

The system SHALL keep answer choices operable by pointer and keyboard without enabling accidental text selection on their labels.

#### Scenario: User clicks an answer choice

- **WHEN** a choice is clicked
- **THEN** its selected state changes without selecting the label text
