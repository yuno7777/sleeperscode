import type { ContinuationPacket } from "@t3tools/client-runtime/continuation-packet";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

function externalUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function hasContinuationEvidence(packet: ContinuationPacket): boolean {
  return (
    packet.changed.length > 0 ||
    packet.verificationReceipts.length > 0 ||
    packet.research.length > 0 ||
    packet.nextActions[0] !== "Review the changed files and verification before continuing."
  );
}

export function ContinuationPacketCard(props: { readonly packet: ContinuationPacket }) {
  const passedCount = props.packet.verificationReceipts.filter(
    (receipt) => receipt.outcome === "passed",
  ).length;
  const failedCount = props.packet.verificationReceipts.length - passedCount;

  return (
    <View className="gap-2.5 rounded-[20px] border border-neutral-200 bg-neutral-100 p-4 dark:border-white/6 dark:bg-neutral-900">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
        Continuation
      </Text>
      <Text className="font-t3-bold text-base text-neutral-950 dark:text-neutral-50">
        Observed work evidence
      </Text>
      <Text className="font-sans text-sm leading-normal text-neutral-600 dark:text-neutral-400">
        {props.packet.changed.length} changed files · {passedCount} passing receipts
        {failedCount > 0 ? ` · ${failedCount} failed` : ""}
      </Text>

      {props.packet.nextActions.slice(0, 2).map((action) => (
        <Text
          key={action}
          className="font-sans text-sm leading-normal text-neutral-700 dark:text-neutral-300"
        >
          Next: {action}
        </Text>
      ))}

      {props.packet.changed.length > 0 ? (
        <View className="gap-1">
          <Text className="font-t3-bold text-2xs uppercase tracking-[1px] text-neutral-500 dark:text-neutral-500">
            Declared files
          </Text>
          {props.packet.changed.slice(0, 4).map((path) => (
            <Text
              key={path}
              numberOfLines={1}
              className="font-mono text-xs text-neutral-700 dark:text-neutral-300"
            >
              {path}
            </Text>
          ))}
        </View>
      ) : null}

      {props.packet.verificationReceipts.length > 0 ? (
        <View className="gap-1">
          <Text className="font-t3-bold text-2xs uppercase tracking-[1px] text-neutral-500 dark:text-neutral-500">
            Verification receipts
          </Text>
          {props.packet.verificationReceipts.slice(0, 3).map((receipt) => (
            <Text
              key={`${receipt.occurredAt}:${receipt.label}`}
              numberOfLines={1}
              className={
                receipt.outcome === "passed"
                  ? "font-mono text-xs text-emerald-700 dark:text-emerald-300"
                  : "font-mono text-xs text-rose-700 dark:text-rose-300"
              }
            >
              {receipt.outcome === "passed" ? "Passed: " : "Failed: "}
              {receipt.label}
            </Text>
          ))}
        </View>
      ) : null}

      {props.packet.research.slice(0, 2).map((research, index) => {
        const url = externalUrl(research.url);
        const label = research.query ?? "Web research";
        return url ? (
          <Pressable
            key={`${research.occurredAt}:${index}`}
            accessibilityHint="Opens this researched source in your browser"
            accessibilityRole="link"
            className="self-start active:opacity-70"
            onPress={() => void Linking.openURL(url)}
          >
            <Text numberOfLines={1} className="font-sans text-sm text-sky-700 dark:text-sky-300">
              Research: {label}
            </Text>
          </Pressable>
        ) : null;
      })}
    </View>
  );
}
