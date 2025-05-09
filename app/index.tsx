import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ScreenOrientation from "expo-screen-orientation";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, State as BleState, Device } from "react-native-ble-plx";
import { btoa } from "react-native-quick-base64";


const manager = new BleManager();
const SCAN_DURATION_MS = 10000; // 10 seconds

// Default command mapping
const DEFAULT_COMMANDS = {
  F: "F", // Forward
  B: "B", // Backward
  L: "L", // Left
  R: "R", // Right
  S: "S", // Stop
  "+": "+", // Speed up
  "-": "-", // Speed down
};

export default function App() {
  const [device, setDevice] = useState<Device | null>(null);
  const [devicesMap, setDevicesMap] = useState<Map<string, Device>>(new Map());
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(50); // 0-100, step 10
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    null
  );
  const [showDeviceModal, setShowDeviceModal] = useState<boolean>(false);

  const [serviceUUID, setServiceUUID] = useState<string | null>(null);
  const [characteristicUUID, setCharacteristicUUID] = useState<string | null>(
    null
  );

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"about" | "help" | "advanced">(
    "about"
  );
  const [commandMap, setCommandMap] = useState({ ...DEFAULT_COMMANDS });
  const [editMap, setEditMap] = useState({ ...DEFAULT_COMMANDS });

  const scanTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Force landscape orientation on mount
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    Alert.alert(
      "Enable Bluetooth & Location",
      "Please make sure your Bluetooth and Location are turned on for BLE scanning."
    );
    return () => {
      manager.stopDeviceScan();
      manager.destroy();
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      // Optionally unlock orientation on unmount:
      // ScreenOrientation.unlockAsync();
    };
  }, []);

  const requestAndroidPermissions = async () => {
    if (Platform.OS !== "android") return true;
    try {
      const apiLevel = Platform.Version as number;
      if (apiLevel >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status === "granted";
      }
    } catch (e) {
      Alert.alert("Permission error", e?.toString());
      return false;
    }
  };

  const scanForDevices = async () => {
    const bleState = await manager.state();
    let locationStatus = "granted";
    let locationEnabled = true;
    if (Platform.OS === "android") {
      const statusObj = await Location.getForegroundPermissionsAsync();
      locationStatus = statusObj.status;
      locationEnabled = await Location.hasServicesEnabledAsync();
    }

    const bluetoothOff = bleState !== BleState.PoweredOn;
    const locationOff =
      Platform.OS === "android" &&
      (locationStatus !== "granted" || !locationEnabled);

    if (bluetoothOff && locationOff) {
      Alert.alert(
        "Bluetooth and Location are Off",
        "Please turn on both Bluetooth and Location services (and grant permission) to scan for devices."
      );
      return;
    } else if (bluetoothOff) {
      Alert.alert(
        "Bluetooth is Off",
        "Please turn on Bluetooth to scan for devices."
      );
      return;
    } else if (locationOff) {
      Alert.alert(
        !locationEnabled
          ? "Location is Off"
          : "Location Permission Not Granted",
        !locationEnabled
          ? "Please turn on Location services to scan for devices."
          : "Please grant Location permission to scan for devices."
      );
      return;
    }

    manager.stopDeviceScan();
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
    setDevicesMap(new Map());
    setIsScanning(true);
    setShowDeviceModal(true);

    let permissionGranted = true;
    if (Platform.OS === "android") {
      permissionGranted = await requestAndroidPermissions();
      if (!permissionGranted) {
        Alert.alert("Permission not granted to access Bluetooth/Location");
        setIsScanning(false);
        setShowDeviceModal(false);
        return;
      }
    }

    try {
      manager.startDeviceScan(null, null, (error, scannedDevice) => {
        if (error) {
          console.error(error);
          setIsScanning(false);
          setShowDeviceModal(false);
          if (scanTimeout.current) clearTimeout(scanTimeout.current);
          return;
        }
        if (scannedDevice && (scannedDevice.name || scannedDevice.localName)) {
          setDevicesMap((prev) => {
            if (!prev.has(scannedDevice.id)) {
              const newMap = new Map(prev);
              newMap.set(scannedDevice.id, scannedDevice);
              return newMap;
            }
            return prev;
          });
        }
      });
      scanTimeout.current = setTimeout(() => {
        manager.stopDeviceScan();
        setIsScanning(false);
      }, SCAN_DURATION_MS);
    } catch (e) {
      setIsScanning(false);
      setShowDeviceModal(false);
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      Alert.alert("Scan error", e?.toString());
    }
  };

  const connectToDevice = async (d: Device) => {
    manager.stopDeviceScan();
    if (scanTimeout.current) clearTimeout(scanTimeout.current);
    setIsScanning(false);
    try {
      const connected = await d.connect();
      const discovered =
        await connected.discoverAllServicesAndCharacteristics();
      setDevice(discovered);
      setConnectedDeviceId(discovered.id);

      let foundService: string | null = null;
      let foundChar: string | null = null;
      try {
        const services = await discovered.services();
        for (const service of services) {
          const characteristics = await service.characteristics();
          for (const char of characteristics) {
            if (char.isWritableWithResponse || char.isWritableWithoutResponse) {
              foundService = service.uuid;
              foundChar = char.uuid;
              break;
            }
          }
          if (foundService && foundChar) break;
        }
      } catch (e) {}
      setServiceUUID(foundService);
      setCharacteristicUUID(foundChar);

      setShowDeviceModal(false);
      if (foundService && foundChar) {
        Alert.alert(
          "Connected to " + (discovered.name || discovered.localName),
          `Service UUID: ${foundService}\nCharacteristic UUID: ${foundChar}`
        );
      } else {
        Alert.alert(
          "Connected, but no writable characteristic found.",
          "You may not be able to send commands to this device."
        );
      }
    } catch (err) {
      setIsScanning(false);
      setShowDeviceModal(false);
      Alert.alert("Connection error", err?.toString());
    }
  };

  const disconnectDevice = async () => {
    if (device) {
      try {
        await device.cancelConnection();
      } catch (err) {}
      setDevice(null);
      setConnectedDeviceId(null);
      setServiceUUID(null);
      setCharacteristicUUID(null);
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      Alert.alert("Disconnected", "Device has been disconnected.");
    }
  };

  const sendCommand = async (command: string) => {
    if (!device || !serviceUUID || !characteristicUUID) {
      Alert.alert(
        "Not connected to any BLE device or writable characteristic."
      );
      return;
    }
    try {
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        characteristicUUID,
        btoa(command)
      );
      console.log(`Sent: ${command}`);
    } catch (err) {
      console.error("Send error", err);
    }
  };

  const handleSpeedChange = (delta: number) => {
    setSpeed((prev) => {
      let next = prev + delta;
      if (next > 100) next = 100;
      if (next < 0) next = 0;
      const steps = Math.abs(next - prev) / 10;
      const cmd = delta > 0 ? commandMap["+"] : commandMap["-"];
      for (let i = 0; i < steps; i++) {
        sendCommand(cmd);
      }
      return next;
    });
  };

  const handleDirection = (key: keyof typeof DEFAULT_COMMANDS) =>
    sendCommand(commandMap[key]);

  const openSettings = () => {
    setEditMap({ ...commandMap });
    setShowSettings(true);
    setSettingsTab("about");
  };
  const saveAdvancedSettings = () => {
    setCommandMap({ ...editMap });
    setShowSettings(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f5f5f5" }}>
      <View style={styles.topBar}>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={styles.title}>SCIL BLE Car Controller</Text>
        </View>
        <TouchableOpacity style={styles.settingsButton} onPress={openSettings}>
          <Ionicons name="settings-outline" size={28} color="#333" />
        </TouchableOpacity>
      </View>
      <View style={styles.connBar}>
        {device ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={styles.connectedInfoText}>
              Connected: {device.name || device.localName || "Unnamed"} (
              {device.id})
            </Text>
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnectDevice}
            >
              <Text style={styles.disconnectButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.connectButton}
            onPress={scanForDevices}
            disabled={isScanning}
          >
            <Ionicons name="bluetooth" size={20} color="#fff" />
            <Text style={styles.connectButtonText}>
              {isScanning ? "Scanning..." : "Connect"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.landscapeContainer}>
        <View style={styles.leftPanel}>
          <View style={styles.controllerContainer}>
            <View style={styles.dpadRow}>
              <TouchableOpacity
                style={styles.dpadButton}
                onPress={() => handleDirection("F")}
                disabled={!device}
              >
                <Text style={styles.dpadText}>▲</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dpadRow}>
              <TouchableOpacity
                style={styles.dpadButton}
                onPress={() => handleDirection("L")}
                disabled={!device}
              >
                <Text style={styles.dpadText}>◀</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dpadButton}
                onPress={() => handleDirection("S")}
                disabled={!device}
              >
                <Text style={styles.dpadText}>■</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dpadButton}
                onPress={() => handleDirection("R")}
                disabled={!device}
              >
                <Text style={styles.dpadText}>▶</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.dpadRow}>
              <TouchableOpacity
                style={styles.dpadButton}
                onPress={() => handleDirection("B")}
                disabled={!device}
              >
                <Text style={styles.dpadText}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View style={styles.rightPanel}>
          <View style={styles.speedRow}>
            <TouchableOpacity
              style={styles.speedButton}
              onPress={() => handleSpeedChange(-10)}
              disabled={!device}
            >
              <Text style={styles.speedText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.speedValue}>{speed}</Text>
            <TouchableOpacity
              style={styles.speedButton}
              onPress={() => handleSpeedChange(10)}
              disabled={!device}
            >
              <Text style={styles.speedText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.speedLabel}>Speed (0-100)</Text>
        </View>
      </View>
      <Modal
        visible={showDeviceModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowDeviceModal(false);
          setIsScanning(false);
          manager.stopDeviceScan();
          if (scanTimeout.current) clearTimeout(scanTimeout.current);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nearby Devices</Text>
            {isScanning && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <ActivityIndicator />
                <Text style={{ marginLeft: 10 }}>Scanning...</Text>
              </View>
            )}
            <FlatList
              data={Array.from(devicesMap.values())}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 300, width: "100%" }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.deviceItem,
                    item.id === connectedDeviceId && styles.connectedDevice,
                  ]}
                  onPress={() => connectToDevice(item)}
                  disabled={item.id === connectedDeviceId}
                >
                  <Text>
                    {item.name || item.localName || "Unnamed"} ({item.id})
                  </Text>
                  {item.id === connectedDeviceId && (
                    <Text style={{ color: "green" }}>Connected</Text>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                !isScanning ? (
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ textAlign: "center", color: "#888" }}>
                      No devices found.
                    </Text>
                  </View>
                ) : null
              }
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                width: "100%",
                marginTop: 15,
              }}
            >
              <TouchableOpacity
                style={styles.rescanButton}
                onPress={() => {
                  manager.stopDeviceScan();
                  if (scanTimeout.current) clearTimeout(scanTimeout.current);
                  scanForDevices();
                }}
                disabled={isScanning}
              >
                <Text style={styles.rescanButtonText}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setShowDeviceModal(false);
                  setIsScanning(false);
                  manager.stopDeviceScan();
                  if (scanTimeout.current) clearTimeout(scanTimeout.current);
                }}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={showSettings}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 420, width: "92%" }]}>
            <View style={{ flexDirection: "row", marginBottom: 10 }}>
              <TouchableOpacity
                style={[
                  styles.settingsTab,
                  settingsTab === "about" && styles.settingsTabActive,
                ]}
                onPress={() => setSettingsTab("about")}
              >
                <Text style={styles.settingsTabText}>About</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.settingsTab,
                  settingsTab === "help" && styles.settingsTabActive,
                ]}
                onPress={() => setSettingsTab("help")}
              >
                <Text style={styles.settingsTabText}>Help</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.settingsTab,
                  settingsTab === "advanced" && styles.settingsTabActive,
                ]}
                onPress={() => setSettingsTab("advanced")}
              >
                <Text style={styles.settingsTabText}>Advanced</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ width: "100%" }}>
              {settingsTab === "about" && (
                <View>
                  <Text
                    style={{
                      fontWeight: "bold",
                      fontSize: 18,
                      marginBottom: 8,
                    }}
                  >
                    SCIL BLE Car Controller
                  </Text>
                  <Text>
                    Version 1.0.0{"\n"}
                    Developed for controlling BLE-enabled cars via Bluetooth Low
                    Energy.
                  </Text>
                </View>
              )}
              {settingsTab === "help" && (
                <View>
                  <Text
                    style={{
                      fontWeight: "bold",
                      fontSize: 16,
                      marginBottom: 8,
                    }}
                  >
                    Help
                  </Text>
                  <Text>
                    - Use the D-pad to control the car's direction.{"\n"}- Use
                    the + and - buttons to adjust speed.{"\n"}- Tap the
                    Bluetooth icon to connect/disconnect.{"\n"}- In Advanced,
                    you can remap controller commands.{"\n"}
                  </Text>
                </View>
              )}
              {settingsTab === "advanced" && (
                <View>
                  <Text
                    style={{
                      fontWeight: "bold",
                      fontSize: 16,
                      marginBottom: 8,
                    }}
                  >
                    Advanced: Command Mapping
                  </Text>
                  <Text style={{ marginBottom: 8 }}>
                    You can change the BLE command sent for each control.{"\n"}
                    <Text style={{ color: "#888" }}>
                      (Default: F=Forward, B=Backward, L=Left, R=Right, S=Stop,
                      +=SpeedUp, -=SpeedDown)
                    </Text>
                  </Text>
                  {Object.entries(DEFAULT_COMMANDS).map(([key, defVal]) => (
                    <View
                      key={key}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <Text style={{ width: 90 }}>
                        {key === "F" && "Forward"}
                        {key === "B" && "Backward"}
                        {key === "L" && "Left"}
                        {key === "R" && "Right"}
                        {key === "S" && "Stop"}
                        {key === "+" && "Speed Up"}
                        {key === "-" && "Speed Down"}
                      </Text>
                      <TextInput
                        style={styles.commandInput}
                        value={editMap[key as keyof typeof DEFAULT_COMMANDS]}
                        onChangeText={(v) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [key]: v,
                          }))
                        }
                        autoCapitalize="characters"
                        maxLength={12}
                      />
                      <Text style={{ color: "#888", marginLeft: 6 }}>
                        (Default: {defVal})
                      </Text>
                    </View>
                  ))}
                  <Text style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
                    Note: If you change "F" to "UP", the controller will send
                    "UP" instead of "F" for Forward.
                  </Text>
                </View>
              )}
            </ScrollView>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              {settingsTab === "advanced" && (
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={saveAdvancedSettings}
                >
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowSettings(false)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#023c69",
    textAlign: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
    backgroundColor: "#f5f5f5",
  },
  settingsButton: {
    padding: 6,
    marginLeft: 8,
  },
  connBar: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginBottom: 6,
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1976d2",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  connectButtonText: {
    color: "#fff",
    fontWeight: "bold",
    marginLeft: 8,
    fontSize: 15,
  },
  landscapeContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 12,
  },
  leftPanel: {
    flex: 1.2,
    alignItems: "center",
    justifyContent: "center",
  },
  rightPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  controllerContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  dpadRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  dpadButton: {
    width: 80,
    height: 80,
    margin: 5,
    borderRadius: 40,
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  dpadText: {
    fontSize: 44,
    fontWeight: "bold",
  },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  speedButton: {
    width: 60,
    height: 60,
    borderRadius: 35,
    backgroundColor: "#b0c4de",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 15,
  },
  speedText: {
    fontSize: 38,
    fontWeight: "bold",
  },
  speedValue: {
    fontSize: 38,
    fontWeight: "bold",
    minWidth: 60,
    textAlign: "center",
  },
  speedLabel: {
    fontSize: 14,
    color: "#555",
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "85%",
    maxWidth: 400,
    alignItems: "center",
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
  },
  connectedInfoText: {
    fontSize: 14,
    color: "#333",
  },
  disconnectButton: {
    marginLeft: 10,
    backgroundColor: "#e57373",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  disconnectButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 13,
  },
  deviceItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    marginBottom: 2,
    borderRadius: 5,
  },
  connectedDevice: {
    backgroundColor: "#d0ffd0",
  },
  rescanButton: {
    marginTop: 10,
    backgroundColor: "#b0c4de",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
    minHeight: 40,
  },
  closeButton: {
    marginTop: 10,
    backgroundColor: "#888",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
    minHeight: 40,
    marginLeft: 10,
  },
  rescanButtonText: {
    color: "#222",
    fontWeight: "bold",
    fontSize: 14,
  },
  closeButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  settingsTab: {
    flex: 1,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
  },
  settingsTabActive: {
    borderColor: "#1976d2",
  },
  settingsTabText: {
    fontWeight: "bold",
    fontSize: 15,
    color: "#1976d2",
  },
  saveButton: {
    backgroundColor: "#1976d2",
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 6,
    marginRight: 10,
  },
  saveButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
  commandInput: {
    borderWidth: 1,
    borderColor: "#bbb",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 60,
    fontSize: 15,
    backgroundColor: "#f9f9f9",
    marginLeft: 8,
  },
});
