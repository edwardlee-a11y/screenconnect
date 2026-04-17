import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  vec,
  Group,
  Text,
  useFont,
  Fill,
} from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  withTiming,
  withDecay,
  Easing,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import type { WheelSegment } from '../services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WHEEL_SIZE = Math.min(SCREEN_WIDTH - 48, 340);
const RADIUS     = WHEEL_SIZE / 2;
const CENTER     = vec(RADIUS, RADIUS);

// ─── Colours per segment type ──────────────────────────────────────────────
const SEGMENT_COLORS: Record<string, string> = {
  LOSE:    '#1A1A2E',
  '1.2x':  '#16213E',
  '1.5x':  '#0F3460',
  '2x':    '#533483',
  '3x':    '#E94560',
  '5x':    '#F5A623',
  '10x':   '#7ED321',
  JACKPOT: '#FFD700',
};

interface SpinWheelProps {
  segments: WheelSegment[];
  targetIndex: number | null;   // Set to trigger a spin
  onSpinComplete?: () => void;
}

export function SpinWheel({ segments, targetIndex, onSpinComplete }: SpinWheelProps) {
  const rotation = useSharedValue(0);

  const SEGMENT_COUNT = segments.length || 12;
  const SEGMENT_ANGLE = (2 * Math.PI) / SEGMENT_COUNT;

  // ── Trigger spin animation when targetIndex changes ──────────────────────
  useEffect(() => {
    if (targetIndex === null || segments.length === 0) return;

    // Calculate the exact angle for the target segment to stop at the pointer (top)
    const segmentAngleDeg = 360 / SEGMENT_COUNT;
    const targetAngleDeg  = targetIndex * segmentAngleDeg;

    // Spin at least 5 full rotations + land on target (pointer at top = 270°)
    const spinRotations   = 5 * 360;
    const pointerOffset   = 270;
    const finalAngle      = spinRotations + pointerOffset - targetAngleDeg;

    rotation.value = withTiming(
      rotation.value + finalAngle,
      {
        duration: 4500,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
      },
      (finished) => {
        if (finished && onSpinComplete) {
          runOnJS(onSpinComplete)();
        }
      },
    );
  }, [targetIndex]);

  // ── Draw wheel using Skia ────────────────────────────────────────────────
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  if (segments.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Pointer triangle at top */}
      <View style={styles.pointer} />

      <Animated.View style={[{ width: WHEEL_SIZE, height: WHEEL_SIZE }, animatedStyle]}>
        <Canvas style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
          {segments.map((seg, i) => {
            const startAngle = i * SEGMENT_ANGLE - Math.PI / 2;
            const endAngle   = startAngle + SEGMENT_ANGLE;
            const color      = SEGMENT_COLORS[seg.label] ?? '#333';

            // Build pie slice path
            const path = Skia.Path.Make();
            path.moveTo(RADIUS, RADIUS);
            path.arcToOval(
              { x: 0, y: 0, width: WHEEL_SIZE, height: WHEEL_SIZE },
              (startAngle * 180) / Math.PI,
              (SEGMENT_ANGLE * 180) / Math.PI,
              false,
            );
            path.close();

            // Label position (midpoint of arc, 65% of radius)
            const midAngle = startAngle + SEGMENT_ANGLE / 2;
            const labelR   = RADIUS * 0.65;
            const labelX   = RADIUS + Math.cos(midAngle) * labelR;
            const labelY   = RADIUS + Math.sin(midAngle) * labelR;

            return (
              <Group key={i}>
                <Path path={path} color={color} />
                <Path
                  path={path}
                  color="rgba(255,255,255,0.08)"
                  style="stroke"
                  strokeWidth={1}
                />
              </Group>
            );
          })}

          {/* Center circle */}
          <Path
            path={(() => {
              const p = Skia.Path.Make();
              p.addCircle(RADIUS, RADIUS, 28);
              return p;
            })()}
            color="#0D0D1A"
          />
          <Path
            path={(() => {
              const p = Skia.Path.Make();
              p.addCircle(RADIUS, RADIUS, 28);
              return p;
            })()}
            color="rgba(255,215,0,0.4)"
            style="stroke"
            strokeWidth={2}
          />
        </Canvas>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointer: {
    position: 'absolute',
    top: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 24,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFD700',
    zIndex: 10,
  },
});
