import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BleManager, State as BleState, Device } from "react-native-ble-plx";
import { btoa } from "react-native-quick-base64";

const manager = new BleManager();
const SCAN_DURATION_MS = 10000; // 10 seconds

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

  const scanTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Alert.alert(
      "Enable Bluetooth & Location",
      "Please make sure your Bluetooth and Location are turned on for BLE scanning."
    );
    return () => {
      manager.stopDeviceScan();
      manager.destroy();
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
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
    // Check Bluetooth state
    const bleState = await manager.state();
    // Check Location state (for Android)
    let locationStatus = "granted";
    let locationEnabled = true;
    if (Platform.OS === "android") {
      const statusObj = await Location.getForegroundPermissionsAsync();
      locationStatus = statusObj.status;
      locationEnabled = await Location.hasServicesEnabledAsync();
    }

    // Compose alert if either or both are off
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
      // Set scan timeout to stop scanning after SCAN_DURATION_MS
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
    setIsScanning(false); // Ensure scanning state is reset
    try {
      const connected = await d.connect();
      const discovered =
        await connected.discoverAllServicesAndCharacteristics();
      setDevice(discovered);
      setConnectedDeviceId(discovered.id);

      // Find the first writable characteristic from all services
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
      } catch (e) {
        // No writable characteristic found
      }
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
      setIsScanning(false); // Reset scanning state on error
      setShowDeviceModal(false);
      Alert.alert("Connection error", err?.toString());
    }
  };

  const disconnectDevice = async () => {
    if (device) {
      try {
        await device.cancelConnection();
      } catch (err) {
        // Ignore disconnect errors
      }
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

  // Controller button handlers
  const handleSpeedChange = (delta: number) => {
    setSpeed((prev) => {
      let next = prev + delta;
      if (next > 100) next = 100;
      if (next < 0) next = 0;

      // Calculate how many steps to send
      const steps = Math.abs(next - prev) / 10;
      const cmd = delta > 0 ? "+" : "-";
      for (let i = 0; i < steps; i++) {
        sendCommand(cmd);
      }
      return next;
    });
  };

  // D-pad commands
  const handleDirection = (cmd: string) => sendCommand(cmd);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f5f5f5" }}>
      <View style={styles.container}>
        <Text style={styles.title}>SCIL BLE Car Controller</Text>
        <View style={styles.section}>
          <Button
            title="Scan for Devices"
            onPress={scanForDevices}
            disabled={isScanning}
          />
        </View>
        {/* Connected device info just below scan button */}
        <View style={styles.connectedInfoContainerAlt}>
          {device ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Text style={styles.connectedInfoText}>
                Connected to: {device.name || device.localName || "Unnamed"} (
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
            <Text style={styles.connectedInfoText}>No device connected</Text>
          )}
        </View>
        <View style={styles.section}>
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
        {/* Device Modal */}
        <Modal
          visible={showDeviceModal}
          transparent
          animationType="slide"
          onRequestClose={() => {
            setShowDeviceModal(false);
            setIsScanning(false); // Reset scanning state when closing modal
            manager.stopDeviceScan(); // Stop BLE scanning when modal closes
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
                    manager.stopDeviceScan(); // Stop BLE scanning when modal closes
                    if (scanTimeout.current) clearTimeout(scanTimeout.current);
                  }}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    paddingHorizontal: 20,
    flexGrow: 1,
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    flex: 1,
  },
  title: {
    fontSize: 24,
    marginBottom: 10,
    marginTop: 20,
    fontWeight: "bold",
  },
  section: {
    width: "100%",
    alignItems: "center",
    marginBottom: 30,
  },
  subtitle: {
    fontSize: 18,
    marginBottom: 10,
    fontWeight: "600",
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
  connectedInfoContainerAlt: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
    marginTop: -10,
    paddingVertical: 8,
    backgroundColor: "rgba(245,245,245,0.95)",
    borderRadius: 8,
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
  rescanButton: {
    marginTop: 10,
    backgroundColor: "#b0c4de",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90, // Ensures consistent width
    minHeight: 40, // Ensures consistent height
  },
  closeButton: {
    marginTop: 10,
    backgroundColor: "#888", // grey color for close
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
    minHeight: 40,
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
});
