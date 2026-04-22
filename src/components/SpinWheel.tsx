import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  vec,
  Group,
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

    // Calculate the exact angle for the target segment CENTER to stop at the pointer (top)
    const segmentAngleDeg = 360 / SEGMENT_COUNT;
    // Add half-segment offset so pointer lands on the CENTER, not the edge
    const targetAngleDeg  = targetIndex * segmentAngleDeg + segmentAngleDeg / 2;

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
        <Canvas style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, position: 'absolute' }}>
          {segments.map((seg, i) => {
            const startAngle = i * SEGMENT_ANGLE - Math.PI / 2;
            const color      = SEGMENT_COLORS[seg.label] ?? '#333';

            const path = Skia.Path.Make();
            path.moveTo(RADIUS, RADIUS);
            path.arcToOval(
              { x: 0, y: 0, width: WHEEL_SIZE, height: WHEEL_SIZE },
              (startAngle * 180) / Math.PI,
              (SEGMENT_ANGLE * 180) / Math.PI,
              false,
            );
            path.close();

            return (
              <Group key={i}>
                <Path path={path} color={color} />
                <Path
                  path={path}
                  color="rgba(255,255,255,0.12)"
                  style="stroke"
                  strokeWidth={1.5}
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

        {/* Segment labels — rotate with the wheel */}
        {segments.map((seg, i) => {
          const startAngle = i * SEGMENT_ANGLE - Math.PI / 2;
          const midAngle   = startAngle + SEGMENT_ANGLE / 2;
          const labelR     = RADIUS * 0.63;
          const labelX     = RADIUS + Math.cos(midAngle) * labelR;
          const labelY     = RADIUS + Math.sin(midAngle) * labelR;
          const rotateDeg  = (midAngle * 180) / Math.PI + 90;
          const isLose     = seg.label === 'LOSE';
          const isJackpot  = seg.label === 'JACKPOT';

          return (
            <View
              key={`lbl-${i}`}
              style={{
                position: 'absolute',
                left: labelX - 24,
                top: labelY - 12,
                width: 48,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ rotate: `${rotateDeg}deg` }],
              }}
            >
              <Text
                style={{
                  color: isJackpot
                    ? '#0D0D1A'
                    : isLose
                    ? 'rgba(255,255,255,0.25)'
                    : '#FFFFFF',
                  fontSize: isJackpot ? 8 : 11,
                  fontWeight: '900',
                  textAlign: 'center',
                  letterSpacing: isJackpot ? 0.5 : 0,
                }}
                numberOfLines={1}
              >
                {isLose ? '✕' : seg.label}
              </Text>
            </View>
          );
        })}
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
