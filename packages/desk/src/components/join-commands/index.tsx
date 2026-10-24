import { Command, type CopyLabels } from '../command'

/** The two commands that add a machine to a space. */
export function JoinCommands({ spaceKey, labels }: { spaceKey: string; labels: CopyLabels }) {
  return (
    <>
      <Command text={`isbell space join ${spaceKey}`} labels={labels} />
      <Command text="isbell gateway install" labels={labels} />
    </>
  )
}
