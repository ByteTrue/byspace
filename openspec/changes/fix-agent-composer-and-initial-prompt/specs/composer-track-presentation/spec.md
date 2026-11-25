# Spec Delta

## Purpose

Defines how composer accessory tracks present their content and communicate horizontal overflow without obscuring controls.

## ADDED Requirements

### Requirement: Edge treatments match actual overflow

Composer tracks SHALL render contained accessories without edge fading when all content fits and SHALL apply any overflow fade only when horizontal scrolling is available.

#### Scenario: A single accessory fits within the track

- **WHEN** the track content does not exceed its visible width
- **THEN** every accessory remains fully opaque and no transparent edge mask is applied

#### Scenario: Accessories exceed the visible width

- **WHEN** the track has horizontally scrollable overflow
- **THEN** the track may use an edge fade to communicate the hidden content without affecting non-overflowing tracks
