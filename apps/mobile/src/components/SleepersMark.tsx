import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

export function SleepersMark(props: { readonly height: number; readonly color: ColorValue }) {
  return (
    <Svg
      accessibilityLabel="Sleepers"
      height={props.height}
      width={props.height}
      viewBox="0 0 24 24"
    >
      <Path d="M15.6 3.2A8.8 8.8 0 1 0 20.8 16a7.6 7.6 0 0 1-5.2-12.8Z" fill={props.color} />
      <Path
        d="m18.7 5 .65 1.55L21 7.2l-1.65.65-.65 1.55-.65-1.55-1.65-.65 1.65-.65L18.7 5Z"
        fill={props.color}
      />
    </Svg>
  );
}
