import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, space, type } from './theme';

/** An empty or failed state: a title, a line, and maybe one action. */
export function Message({
  title,
  lead,
  action,
}: {
  title?: string;
  lead?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.box}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} kind="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space.xl, gap: space.m, alignItems: 'flex-start' },
  title: { ...type.heading, color: colors.text },
  lead: { ...type.body, color: colors.textMuted },
});
